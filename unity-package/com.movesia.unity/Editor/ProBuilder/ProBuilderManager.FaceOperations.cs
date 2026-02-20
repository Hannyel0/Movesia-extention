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
using Math = UnityEngine.ProBuilder.Math;
using EditorUtility = UnityEditor.EditorUtility;

/// <summary>
/// Face-level operations for ProBuilderManager:
///   extrude, set_face_material, set_face_color, delete_faces, flip_normals, subdivide, bevel
///
/// All operations use the SelectFaces system for face selection and return FaceOperationResult.
/// </summary>
public static partial class ProBuilderManager
{
    // =========================================================================
    // ACTION: extrude
    // =========================================================================

    /// <summary>
    /// Extrude selected faces outward (or inward with negative distance).
    /// After extrusion, the selectedFaces list references the new extruded top faces,
    /// so post-extrude styling (resultColor, resultMaterial) applies to the right faces automatically.
    ///
    /// Required: instanceId (int)
    /// Optional:
    ///   faceSelection          — Which faces to extrude (default: all). See SelectFaces.
    ///   distance (float, 0.5)  — Extrusion distance (negative = inward)
    ///   extrudeMethod (string) — "FaceNormal" (default), "IndividualFaces", "VertexNormal"
    ///   resultColor ([r,g,b,a]) — Vertex color applied to extruded faces after extrusion
    ///   resultMaterial         — Material applied to extruded faces after extrusion.
    ///                            Accepts all 3 formats: int, string, or {create:true, ...}
    ///
    /// Returns: FaceOperationResult with affectedFaces count + optional materialInstanceId
    /// </summary>
    public static FaceOperationResult Extrude(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return FaceOpFail("extrude", findError);

            var (selectedFaces, selError) = SelectFaces(mesh, body?["faceSelection"]);
            if (selError != null)
                return FaceOpFail("extrude", selError);

            float distance = body?["distance"]?.ToObject<float>() ?? 0.5f;

            // Parse extrude method
            ExtrudeMethod extrudeMethod = ExtrudeMethod.FaceNormal;
            string methodStr = body?["extrudeMethod"]?.ToString();
            if (!string.IsNullOrEmpty(methodStr))
            {
                switch (methodStr.ToLowerInvariant().Replace("_", ""))
                {
                    case "individualfaces":
                    case "individual":
                        extrudeMethod = ExtrudeMethod.IndividualFaces;
                        break;
                    case "facenormal":
                    case "normal":
                        extrudeMethod = ExtrudeMethod.FaceNormal;
                        break;
                    case "vertexnormal":
                    case "vertex":
                        extrudeMethod = ExtrudeMethod.VertexNormal;
                        break;
                }
            }

            Undo.RecordObject(mesh, "Extrude ProBuilder Faces");

            mesh.Extrude(selectedFaces, extrudeMethod, distance);

            // After extrusion, the selectedFaces list now references the extruded (new top) faces.
            // Apply optional post-extrude styling to those faces.

            // Post-extrude: apply vertex color
            var resultColorArr = body?["resultColor"]?.ToObject<float[]>();
            if (resultColorArr != null && resultColorArr.Length >= 3)
            {
                Color color = new Color(resultColorArr[0], resultColorArr[1], resultColorArr[2],
                    resultColorArr.Length > 3 ? resultColorArr[3] : 1f);
                foreach (var face in selectedFaces)
                    mesh.SetFaceColor(face, color);
            }

            // Post-extrude: apply material
            Material inlineMat = null;
            var resultMatToken = body?["resultMaterial"];
            if (resultMatToken != null)
            {
                var (mat, matError) = ResolveMaterialToken(resultMatToken);
                if (matError != null)
                {
                    // Extrusion succeeded but material failed — still rebuild and report
                    RebuildMesh(mesh);
                    var partialResult = FaceOpResult("extrude", mesh, selectedFaces.Count);
                    partialResult.error = $"Extrude succeeded but resultMaterial failed: {matError}";
                    return partialResult;
                }
                if (mat != null)
                {
                    Undo.RecordObject(mesh.GetComponent<Renderer>(), "Set Extruded Face Material");
                    mesh.SetMaterial(selectedFaces, mat);
                    inlineMat = mat;
                }
            }

            RebuildMesh(mesh);

            Debug.Log($"🔧 ProBuilder: Extruded {selectedFaces.Count} faces on '{mesh.gameObject.name}' by {distance}" +
                      $"{(resultColorArr != null ? " +color" : "")}{(inlineMat != null ? $" +material={inlineMat.name}" : "")}");

            return FaceOpResult("extrude", mesh, selectedFaces.Count, inlineMat);
        }
        catch (Exception ex)
        {
            return FaceOpFail("extrude", ex.Message);
        }
    }

    // =========================================================================
    // ACTION: set_face_material
    // =========================================================================

    /// <summary>
    /// Assign a material to selected faces. Supports inline material creation.
    ///
    /// Required: instanceId (int), material
    /// Optional: faceSelection (default: all faces)
    ///
    /// The "material" field accepts three formats:
    ///   1. int    → instanceId of an existing Material
    ///   2. string → asset path (e.g. "Assets/Materials/Red.mat")
    ///   3. object → {create:true, shaderName?, name?, savePath?, properties:{color:[1,0,0,1]}}
    ///              Creates a new material via MaterialManager.ManageMaterial() inline.
    ///
    /// Returns: FaceOperationResult with materialInstanceId + materialAssetPath for reuse
    /// </summary>
    public static FaceOperationResult SetFaceMaterial(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return FaceOpFail("set_face_material", findError);

            var (selectedFaces, selError) = SelectFaces(mesh, body?["faceSelection"]);
            if (selError != null)
                return FaceOpFail("set_face_material", selError);

            // Resolve material: accepts instanceId (int), assetPath (string),
            // or object with {create:true, shaderName, properties} for inline creation
            var matToken = body?["material"];
            if (matToken == null)
                return FaceOpFail("set_face_material", "material is required (instanceId, assetPath, or {create:true, ...})");

            var (mat, matError) = ResolveMaterialToken(matToken);
            if (matError != null)
                return FaceOpFail("set_face_material", matError);
            if (mat == null)
                return FaceOpFail("set_face_material", "Could not resolve material");

            Undo.RecordObject(mesh.GetComponent<Renderer>(), "Set ProBuilder Face Material");
            mesh.SetMaterial(selectedFaces, mat);

            RebuildMesh(mesh);

            Debug.Log($"🔧 ProBuilder: Set material '{mat.name}' on {selectedFaces.Count} faces of '{mesh.gameObject.name}'");

            return FaceOpResult("set_face_material", mesh, selectedFaces.Count, mat);
        }
        catch (Exception ex)
        {
            return FaceOpFail("set_face_material", ex.Message);
        }
    }

    // =========================================================================
    // ACTION: set_face_color
    // =========================================================================

    /// <summary>
    /// Set vertex color on selected faces.
    /// Required: instanceId, color ([r,g,b] or [r,g,b,a])
    /// Optional: faceSelection (default: all)
    /// </summary>
    public static FaceOperationResult SetFaceColor(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return FaceOpFail("set_face_color", findError);

            var (selectedFaces, selError) = SelectFaces(mesh, body?["faceSelection"]);
            if (selError != null)
                return FaceOpFail("set_face_color", selError);

            var colorArr = body?["color"]?.ToObject<float[]>();
            if (colorArr == null || colorArr.Length < 3)
                return FaceOpFail("set_face_color", "color requires [r, g, b] or [r, g, b, a] array");

            Color color = new Color(colorArr[0], colorArr[1], colorArr[2],
                colorArr.Length > 3 ? colorArr[3] : 1f);

            Undo.RecordObject(mesh, "Set ProBuilder Face Color");

            foreach (var face in selectedFaces)
            {
                mesh.SetFaceColor(face, color);
            }

            RebuildMesh(mesh);

            Debug.Log($"🔧 ProBuilder: Set color on {selectedFaces.Count} faces of '{mesh.gameObject.name}'");

            return FaceOpResult("set_face_color", mesh, selectedFaces.Count);
        }
        catch (Exception ex)
        {
            return FaceOpFail("set_face_color", ex.Message);
        }
    }

    // =========================================================================
    // ACTION: delete_faces
    // =========================================================================

    /// <summary>
    /// Remove selected faces from the mesh. Destructive — use query_face_selection first to preview.
    /// Required: instanceId
    /// Optional: faceSelection (default: all — be careful!)
    /// </summary>
    public static FaceOperationResult DeleteFaces(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return FaceOpFail("delete_faces", findError);

            var (selectedFaces, selError) = SelectFaces(mesh, body?["faceSelection"]);
            if (selError != null)
                return FaceOpFail("delete_faces", selError);

            int deletedCount = selectedFaces.Count;

            Undo.RecordObject(mesh, "Delete ProBuilder Faces");

            mesh.DeleteFaces(selectedFaces);

            RebuildMesh(mesh);

            Debug.Log($"🔧 ProBuilder: Deleted {deletedCount} faces from '{mesh.gameObject.name}'");

            return FaceOpResult("delete_faces", mesh, deletedCount);
        }
        catch (Exception ex)
        {
            return FaceOpFail("delete_faces", ex.Message);
        }
    }

    // =========================================================================
    // ACTION: flip_normals
    // =========================================================================

    /// <summary>
    /// Reverse face winding on selected faces (makes them face the opposite direction).
    /// Common use: flip all normals on a cube to create an inside-out room.
    /// Required: instanceId
    /// Optional: faceSelection (default: all)
    /// </summary>
    public static FaceOperationResult FlipNormals(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return FaceOpFail("flip_normals", findError);

            var (selectedFaces, selError) = SelectFaces(mesh, body?["faceSelection"]);
            if (selError != null)
                return FaceOpFail("flip_normals", selError);

            Undo.RecordObject(mesh, "Flip ProBuilder Normals");

            foreach (var face in selectedFaces)
            {
                face.Reverse();
            }

            RebuildMesh(mesh);

            Debug.Log($"🔧 ProBuilder: Flipped normals on {selectedFaces.Count} faces of '{mesh.gameObject.name}'");

            return FaceOpResult("flip_normals", mesh, selectedFaces.Count);
        }
        catch (Exception ex)
        {
            return FaceOpFail("flip_normals", ex.Message);
        }
    }

    // =========================================================================
    // ACTION: subdivide
    // =========================================================================

    /// <summary>
    /// Subdivide selected faces by inserting edges from edge midpoints to face center.
    /// Increases mesh detail on selected areas.
    /// Required: instanceId
    /// Optional: faceSelection (default: all)
    /// </summary>
    public static FaceOperationResult Subdivide(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return FaceOpFail("subdivide", findError);

            var (selectedFaces, selError) = SelectFaces(mesh, body?["faceSelection"]);
            if (selError != null)
                return FaceOpFail("subdivide", selError);

            Undo.RecordObject(mesh, "Subdivide ProBuilder Mesh");

            // Connect faces inserts edges from edge midpoints to face center
            var newFaces = mesh.Connect(selectedFaces);

            RebuildMesh(mesh);

            int affectedCount = newFaces != null ? newFaces.Length : 0;

            Debug.Log($"🔧 ProBuilder: Subdivided {selectedFaces.Count} faces on '{mesh.gameObject.name}'");

            return FaceOpResult("subdivide", mesh, affectedCount);
        }
        catch (Exception ex)
        {
            return FaceOpFail("subdivide", ex.Message);
        }
    }

    // =========================================================================
    // ACTION: bevel
    // =========================================================================

    /// <summary>
    /// Bevel edges of selected faces by a given distance.
    /// Collects all edges from selected faces and bevels them, creating new faces.
    /// Required: instanceId
    /// Optional: faceSelection (default: all), distance (float, default 0.1)
    /// </summary>
    public static FaceOperationResult BevelEdges(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return FaceOpFail("bevel", findError);

            float amount = body?["distance"]?.ToObject<float>() ?? 0.1f;

            // Collect edges from selected faces
            var (selectedFaces, selError) = SelectFaces(mesh, body?["faceSelection"]);
            if (selError != null)
                return FaceOpFail("bevel", selError);

            var edges = selectedFaces.SelectMany(f => f.edges).Distinct().ToList();

            Undo.RecordObject(mesh, "Bevel ProBuilder Edges");

            var newFaces = Bevel.BevelEdges(mesh, edges, amount);

            RebuildMesh(mesh);

            int affectedCount = newFaces != null ? newFaces.Count : 0;

            Debug.Log($"🔧 ProBuilder: Beveled {edges.Count} edges on '{mesh.gameObject.name}' " +
                      $"(created {affectedCount} new faces)");

            return FaceOpResult("bevel", mesh, affectedCount);
        }
        catch (Exception ex)
        {
            return FaceOpFail("bevel", ex.Message);
        }
    }
}
#endif
