#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using UnityEngine.ProBuilder;
using UnityEngine.ProBuilder.MeshOperations;
using UnityEditor.ProBuilder;
using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

// Resolve ambiguities between ProBuilder and System/UnityEditor namespaces
using EditorUtility = UnityEditor.EditorUtility;

/// <summary>
/// Pipeline action for ProBuilderManager.
///
/// Executes a sequence of ProBuilder operations on a single mesh with only ONE
/// RebuildMesh call at the end. This avoids N redundant ToMesh/Refresh/Optimize
/// cycles and collapses multiple WebSocket round-trips into a single call.
///
/// Supported step operations:
///   extrude          — with optional resultColor + resultMaterial
///   subdivide        — face subdivision via Connect
///   delete_faces     — remove selected faces
///   flip_normals     — reverse face winding
///   set_face_material — assign material (supports inline {create:true})
///   set_face_color   — set vertex colors
///   bevel            — bevel edges of selected faces
///
/// Error handling: each step runs independently — a failed step is logged but
/// doesn't block subsequent steps. The final result reports stepsExecuted vs stepsTotal.
///
/// Performance: for a 5-step pipeline, this means ~5x less overhead from
/// ToMesh/Refresh/Optimize compared to 5 individual API calls.
/// </summary>
public static partial class ProBuilderManager
{
    // =========================================================================
    // ACTION: pipeline (multi-step operations, single rebuild)
    // =========================================================================

    /// <summary>
    /// Execute a sequence of ProBuilder operations on a single mesh with only ONE
    /// RebuildMesh call at the end.
    ///
    /// Required: instanceId (int), steps (array of step objects)
    ///
    /// Each step object must have:
    ///   op (string) — operation name: "extrude", "subdivide", "delete_faces",
    ///                 "flip_normals", "set_face_material", "set_face_color", "bevel"
    ///
    /// Each step can have operation-specific params (same as standalone actions):
    ///   extrude:          faceSelection, distance, extrudeMethod, resultColor, resultMaterial
    ///   subdivide:        faceSelection
    ///   delete_faces:     faceSelection
    ///   flip_normals:     faceSelection
    ///   set_face_material: faceSelection, material (supports inline {create:true})
    ///   set_face_color:   faceSelection, color
    ///   bevel:            faceSelection, distance
    ///
    /// Returns: PipelineResult with final mesh stats + per-step results array.
    /// </summary>
    public static PipelineResult ExecutePipeline(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return new PipelineResult { success = false, error = findError, action = "pipeline" };

            var stepsToken = body?["steps"];
            if (stepsToken == null || stepsToken.Type != JTokenType.Array)
                return new PipelineResult { success = false, error = "steps array is required", action = "pipeline" };

            var steps = (JArray)stepsToken;
            if (steps.Count == 0)
                return new PipelineResult { success = false, error = "steps array must not be empty", action = "pipeline" };

            Undo.RecordObject(mesh, "ProBuilder Pipeline");
            var rendererRecorded = false;

            var stepResults = new List<PipelineStepResult>();
            int stepsExecuted = 0;

            for (int i = 0; i < steps.Count; i++)
            {
                var step = steps[i] as JObject;
                if (step == null)
                {
                    stepResults.Add(new PipelineStepResult
                        { stepIndex = i, operation = "unknown", success = false, error = "step must be an object" });
                    continue;
                }

                string op = step?["op"]?.ToString() ?? step?["operation"]?.ToString() ?? step?["action"]?.ToString();
                if (string.IsNullOrEmpty(op))
                {
                    stepResults.Add(new PipelineStepResult
                        { stepIndex = i, operation = "unknown", success = false, error = "op is required in each step" });
                    continue;
                }

                string normalizedOp = op.ToLowerInvariant().Replace("_", "");

                try
                {
                    string stepError = null;
                    int affectedFaces = 0;

                    switch (normalizedOp)
                    {
                        case "extrude":
                        {
                            var (faces, selErr) = SelectFaces(mesh, step?["faceSelection"]);
                            if (selErr != null) { stepError = selErr; break; }

                            float dist = step?["distance"]?.ToObject<float>() ?? 0.5f;
                            ExtrudeMethod em = ExtrudeMethod.FaceNormal;
                            string emStr = step?["extrudeMethod"]?.ToString();
                            if (!string.IsNullOrEmpty(emStr))
                            {
                                switch (emStr.ToLowerInvariant().Replace("_", ""))
                                {
                                    case "individualfaces": case "individual": em = ExtrudeMethod.IndividualFaces; break;
                                    case "vertexnormal": case "vertex": em = ExtrudeMethod.VertexNormal; break;
                                }
                            }
                            mesh.Extrude(faces, em, dist);
                            affectedFaces = faces.Count;

                            // Post-extrude color
                            var colorArr = step?["resultColor"]?.ToObject<float[]>();
                            if (colorArr != null && colorArr.Length >= 3)
                            {
                                Color c = new Color(colorArr[0], colorArr[1], colorArr[2],
                                    colorArr.Length > 3 ? colorArr[3] : 1f);
                                foreach (var f in faces) mesh.SetFaceColor(f, c);
                            }

                            // Post-extrude material
                            var matToken = step?["resultMaterial"];
                            if (matToken != null)
                            {
                                var (mat, matErr) = ResolveMaterialToken(matToken);
                                if (matErr != null) { stepError = $"extrude ok but resultMaterial failed: {matErr}"; }
                                else if (mat != null)
                                {
                                    if (!rendererRecorded)
                                    {
                                        Undo.RecordObject(mesh.GetComponent<Renderer>(), "Pipeline Material");
                                        rendererRecorded = true;
                                    }
                                    mesh.SetMaterial(faces, mat);
                                }
                            }
                            break;
                        }

                        case "subdivide":
                        {
                            var (faces, selErr) = SelectFaces(mesh, step?["faceSelection"]);
                            if (selErr != null) { stepError = selErr; break; }
                            var newFaces = mesh.Connect(faces);
                            affectedFaces = newFaces != null ? newFaces.Length : 0;
                            break;
                        }

                        case "deletefaces":
                        {
                            var (faces, selErr) = SelectFaces(mesh, step?["faceSelection"]);
                            if (selErr != null) { stepError = selErr; break; }
                            affectedFaces = faces.Count;
                            mesh.DeleteFaces(faces);
                            break;
                        }

                        case "flipnormals":
                        {
                            var (faces, selErr) = SelectFaces(mesh, step?["faceSelection"]);
                            if (selErr != null) { stepError = selErr; break; }
                            foreach (var f in faces) f.Reverse();
                            affectedFaces = faces.Count;
                            break;
                        }

                        case "setfacematerial":
                        {
                            var (faces, selErr) = SelectFaces(mesh, step?["faceSelection"]);
                            if (selErr != null) { stepError = selErr; break; }

                            var matToken = step?["material"];
                            if (matToken == null) { stepError = "material is required"; break; }
                            var (mat, matErr) = ResolveMaterialToken(matToken);
                            if (matErr != null) { stepError = matErr; break; }

                            if (!rendererRecorded)
                            {
                                Undo.RecordObject(mesh.GetComponent<Renderer>(), "Pipeline Material");
                                rendererRecorded = true;
                            }
                            mesh.SetMaterial(faces, mat);
                            affectedFaces = faces.Count;
                            break;
                        }

                        case "setfacecolor":
                        {
                            var (faces, selErr) = SelectFaces(mesh, step?["faceSelection"]);
                            if (selErr != null) { stepError = selErr; break; }

                            var cArr = step?["color"]?.ToObject<float[]>();
                            if (cArr == null || cArr.Length < 3) { stepError = "color [r,g,b] or [r,g,b,a] is required"; break; }
                            Color col = new Color(cArr[0], cArr[1], cArr[2], cArr.Length > 3 ? cArr[3] : 1f);
                            foreach (var f in faces) mesh.SetFaceColor(f, col);
                            affectedFaces = faces.Count;
                            break;
                        }

                        case "bevel":
                        {
                            var (faces, selErr) = SelectFaces(mesh, step?["faceSelection"]);
                            if (selErr != null) { stepError = selErr; break; }
                            float amt = step?["distance"]?.ToObject<float>() ?? 0.1f;
                            var edges = faces.SelectMany(f => f.edges).Distinct().ToList();
                            var newFaces = Bevel.BevelEdges(mesh, edges, amt);
                            affectedFaces = newFaces != null ? newFaces.Count : 0;
                            break;
                        }

                        default:
                            stepError = $"Unknown pipeline operation: '{op}'. " +
                                "Valid: extrude, subdivide, delete_faces, flip_normals, set_face_material, set_face_color, bevel";
                            break;
                    }

                    stepResults.Add(new PipelineStepResult
                    {
                        stepIndex = i,
                        operation = op,
                        success = stepError == null,
                        error = stepError,
                        affectedFaces = affectedFaces
                    });

                    if (stepError == null)
                        stepsExecuted++;
                }
                catch (Exception stepEx)
                {
                    stepResults.Add(new PipelineStepResult
                    {
                        stepIndex = i, operation = op, success = false, error = stepEx.Message
                    });
                }
            }

            // Single rebuild at the end
            RebuildMesh(mesh);

            Debug.Log($"🔧 ProBuilder: Pipeline executed {stepsExecuted}/{steps.Count} steps on '{mesh.gameObject.name}'");

            return new PipelineResult
            {
                success = stepsExecuted == steps.Count,
                error = stepsExecuted < steps.Count ? $"{steps.Count - stepsExecuted} step(s) failed" : null,
                action = "pipeline",
                instanceId = mesh.gameObject.GetInstanceID(),
                name = mesh.gameObject.name,
                faceCount = mesh.faceCount,
                vertexCount = mesh.vertexCount,
                edgeCount = mesh.faces.Sum(f => f.edges.Count),
                stepsExecuted = stepsExecuted,
                stepsTotal = steps.Count,
                stepResults = stepResults.ToArray()
            };
        }
        catch (Exception ex)
        {
            return new PipelineResult { success = false, error = ex.Message, action = "pipeline" };
        }
    }
}
#endif
