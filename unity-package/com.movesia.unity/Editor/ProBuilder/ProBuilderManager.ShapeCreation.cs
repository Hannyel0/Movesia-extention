#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using UnityEngine.ProBuilder;
using UnityEngine.ProBuilder.MeshOperations;
using UnityEditor.ProBuilder;
using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

// Resolve ambiguities between ProBuilder and System/UnityEditor namespaces
using EditorUtility = UnityEditor.EditorUtility;

/// <summary>
/// Shape creation actions for ProBuilderManager: create_shape and create_poly_shape.
///
/// create_shape supports 12 primitive types:
///   Cube, Cylinder, Cone, Plane, Pipe, Arch, Stair, CurvedStair, Door, Torus, Icosahedron, Prism
///
/// Both actions support inline material, components, and transform parameters.
/// </summary>
public static partial class ProBuilderManager
{
    // =========================================================================
    // ACTION: create_shape
    // =========================================================================

    /// <summary>
    /// Create a ProBuilder primitive shape with optional inline material, components, and transform.
    ///
    /// Required params:
    ///   shapeType (string) — One of: Cube, Cylinder, Cone, Plane, Pipe, Arch, Stair,
    ///                        CurvedStair, Door, Torus, Icosahedron, Prism
    ///
    /// Optional params:
    ///   name (string)          — GameObject name
    ///   position ([x,y,z])     — World position
    ///   rotation ([x,y,z])     — Euler angles
    ///   scale ([x,y,z])        — Local scale
    ///   components (string[])  — Component types to add, e.g. ["BoxCollider", "Rigidbody"]
    ///   material               — Inline material: int (instanceId), string (assetPath),
    ///                            or {create:true, properties:{color:[1,0,0,1]}} for auto-creation
    ///   + shape-specific params (size, radius, height, subdivisions, etc.)
    ///
    /// Returns: ProBuilderResult with instanceId, mesh stats, and optional materialInstanceId/materialAssetPath
    /// </summary>
    public static ProBuilderResult CreateShape(JObject body)
    {
        try
        {
            string shapeType = body?["shapeType"]?.ToString();
            if (string.IsNullOrEmpty(shapeType))
                return Fail("create_shape", "shapeType is required. Valid: Cube, Cylinder, Cone, Plane, " +
                    "Pipe, Arch, Stair, CurvedStair, Door, Torus, Icosahedron, Prism");

            string goName = body?["name"]?.ToString();
            float[] position = body?["position"]?.ToObject<float[]>();
            float[] rotation = body?["rotation"]?.ToObject<float[]>();

            ProBuilderMesh mesh;

            switch (shapeType.ToLowerInvariant().Replace("_", ""))
            {
                case "cube":
                case "box":
                {
                    var size = ParseVector3(body, "size", new Vector3(1, 1, 1));
                    mesh = ShapeGenerator.GenerateCube(PivotLocation.Center, size);
                    break;
                }

                case "cylinder":
                {
                    int subdivAxis = body?["subdivAxis"]?.ToObject<int>() ?? body?["sides"]?.ToObject<int>() ?? 24;
                    float radius = body?["radius"]?.ToObject<float>() ?? 0.5f;
                    float height = body?["height"]?.ToObject<float>() ?? 1f;
                    int heightCuts = body?["heightCuts"]?.ToObject<int>() ?? 0;
                    int smoothing = body?["smooth"]?.ToObject<int>() ?? 1;
                    mesh = ShapeGenerator.GenerateCylinder(PivotLocation.Center,
                        subdivAxis, radius, height, heightCuts, smoothing);
                    break;
                }

                case "cone":
                {
                    float radius = body?["radius"]?.ToObject<float>() ?? 0.5f;
                    float height = body?["height"]?.ToObject<float>() ?? 1f;
                    int subdivAxis = body?["subdivAxis"]?.ToObject<int>() ?? body?["sides"]?.ToObject<int>() ?? 6;
                    mesh = ShapeGenerator.GenerateCone(PivotLocation.Center,
                        radius, height, subdivAxis);
                    break;
                }

                case "plane":
                {
                    float width = body?["width"]?.ToObject<float>() ?? 1f;
                    float height = body?["height"]?.ToObject<float>() ?? 1f;
                    int widthCuts = body?["widthCuts"]?.ToObject<int>() ?? 0;
                    int heightCuts = body?["heightCuts"]?.ToObject<int>() ?? 0;
                    mesh = ShapeGenerator.GeneratePlane(PivotLocation.Center,
                        width, height, widthCuts, heightCuts, Axis.Up);
                    break;
                }

                case "pipe":
                case "tube":
                {
                    float radius = body?["radius"]?.ToObject<float>() ?? 1f;
                    float height = body?["height"]?.ToObject<float>() ?? 2f;
                    float thickness = body?["thickness"]?.ToObject<float>() ?? 0.25f;
                    int subdivAxis = body?["subdivAxis"]?.ToObject<int>() ?? body?["sides"]?.ToObject<int>() ?? 8;
                    int subdivHeight = body?["subdivHeight"]?.ToObject<int>() ?? 1;
                    mesh = ShapeGenerator.GeneratePipe(PivotLocation.Center,
                        radius, height, thickness, subdivAxis, subdivHeight);
                    break;
                }

                case "arch":
                {
                    float angle = body?["angle"]?.ToObject<float>() ?? 180f;
                    float radius = body?["radius"]?.ToObject<float>() ?? 1f;
                    float width = body?["width"]?.ToObject<float>() ?? 0.5f;
                    float depth = body?["depth"]?.ToObject<float>() ?? 0.25f;
                    int radialCuts = body?["radialCuts"]?.ToObject<int>() ?? 6;
                    bool insideFaces = body?["insideFaces"]?.ToObject<bool>() ?? true;
                    bool outsideFaces = body?["outsideFaces"]?.ToObject<bool>() ?? true;
                    bool frontFaces = body?["frontFaces"]?.ToObject<bool>() ?? true;
                    bool backFaces = body?["backFaces"]?.ToObject<bool>() ?? true;
                    bool endCaps = body?["endCaps"]?.ToObject<bool>() ?? true;
                    mesh = ShapeGenerator.GenerateArch(PivotLocation.Center,
                        angle, radius, width, depth, radialCuts,
                        insideFaces, outsideFaces, frontFaces, backFaces, endCaps);
                    break;
                }

                case "stair":
                case "stairs":
                {
                    var size = ParseVector3(body, "size", new Vector3(2, 2.5f, 4));
                    int steps = body?["steps"]?.ToObject<int>() ?? 6;
                    bool buildSides = body?["buildSides"]?.ToObject<bool>() ?? true;
                    mesh = ShapeGenerator.GenerateStair(PivotLocation.Center,
                        size, steps, buildSides);
                    break;
                }

                case "curvedstair":
                case "curvedstairs":
                {
                    float stairWidth = body?["stairWidth"]?.ToObject<float>() ?? body?["width"]?.ToObject<float>() ?? 2f;
                    float height = body?["height"]?.ToObject<float>() ?? 2.5f;
                    float innerRadius = body?["innerRadius"]?.ToObject<float>() ?? 0.5f;
                    float circumference = body?["circumference"]?.ToObject<float>() ?? 90f;
                    int steps = body?["steps"]?.ToObject<int>() ?? 8;
                    bool buildSides = body?["buildSides"]?.ToObject<bool>() ?? true;
                    mesh = ShapeGenerator.GenerateCurvedStair(PivotLocation.Center,
                        stairWidth, height, innerRadius, circumference, steps, buildSides);
                    break;
                }

                case "door":
                {
                    float totalWidth = body?["totalWidth"]?.ToObject<float>() ?? body?["width"]?.ToObject<float>() ?? 4f;
                    float totalHeight = body?["totalHeight"]?.ToObject<float>() ?? body?["height"]?.ToObject<float>() ?? 4f;
                    float ledgeHeight = body?["ledgeHeight"]?.ToObject<float>() ?? 1f;
                    float legWidth = body?["legWidth"]?.ToObject<float>() ?? 1f;
                    float depth = body?["depth"]?.ToObject<float>() ?? 0.5f;
                    mesh = ShapeGenerator.GenerateDoor(PivotLocation.Center,
                        totalWidth, totalHeight, ledgeHeight, legWidth, depth);
                    break;
                }

                case "torus":
                case "donut":
                {
                    int rows = body?["rows"]?.ToObject<int>() ?? 16;
                    int columns = body?["columns"]?.ToObject<int>() ?? 24;
                    float innerRadius = body?["innerRadius"]?.ToObject<float>() ?? 0.25f;
                    float outerRadius = body?["outerRadius"]?.ToObject<float>() ?? body?["radius"]?.ToObject<float>() ?? 1f;
                    bool smooth = body?["smooth"]?.ToObject<bool>() ?? true;
                    float hCircumference = body?["circumference"]?.ToObject<float>() ?? 360f;
                    float vCircumference = 360f;
                    mesh = ShapeGenerator.GenerateTorus(PivotLocation.Center,
                        rows, columns, innerRadius, outerRadius, smooth,
                        hCircumference, vCircumference);
                    break;
                }

                case "icosahedron":
                case "sphere":
                case "icosphere":
                {
                    float radius = body?["radius"]?.ToObject<float>() ?? 0.5f;
                    int subdivisions = body?["subdivisions"]?.ToObject<int>() ?? 2;
                    mesh = ShapeGenerator.GenerateIcosahedron(PivotLocation.Center,
                        radius, subdivisions);
                    break;
                }

                case "prism":
                case "triangularprism":
                {
                    var size = ParseVector3(body, "size", new Vector3(1, 1, 1));
                    mesh = ShapeGenerator.GeneratePrism(PivotLocation.Center, size);
                    break;
                }

                default:
                    return Fail("create_shape", $"Unknown shapeType: '{shapeType}'. " +
                        "Valid: Cube, Cylinder, Cone, Plane, Pipe, Arch, Stair, " +
                        "CurvedStair, Door, Torus, Icosahedron, Prism");
            }

            // Mandatory rebuild
            RebuildMesh(mesh);

            // Apply name
            if (!string.IsNullOrEmpty(goName))
                mesh.gameObject.name = goName;

            // Apply transform
            if (position != null && position.Length >= 3)
                mesh.transform.localPosition = new Vector3(position[0], position[1], position[2]);
            if (rotation != null && rotation.Length >= 3)
                mesh.transform.localEulerAngles = new Vector3(rotation[0], rotation[1], rotation[2]);

            // Apply optional scale
            float[] scaleArr = body?["scale"]?.ToObject<float[]>();
            if (scaleArr != null && scaleArr.Length >= 3)
                mesh.transform.localScale = new Vector3(scaleArr[0], scaleArr[1], scaleArr[2]);

            // Undo support
            Undo.RegisterCreatedObjectUndo(mesh.gameObject, $"Create ProBuilder {shapeType}");

            // Apply inline components (e.g., "components": ["BoxCollider", "Rigidbody"])
            ApplyInlineComponents(mesh.gameObject, body?["components"]);

            // Apply inline material (int, string, or {create:true, ...})
            var matToken = body?["material"];
            Material inlineMat = null;
            if (matToken != null)
            {
                var (mat, matError) = ResolveMaterialToken(matToken);
                if (matError != null)
                {
                    // Shape was created successfully, but material failed — report partial success
                    var partialResult = MeshResult("create_shape", mesh);
                    partialResult.error = $"Shape created but material failed: {matError}";
                    return partialResult;
                }
                if (mat != null)
                {
                    Undo.RecordObject(mesh.GetComponent<Renderer>(), "Set ProBuilder Shape Material");
                    mesh.SetMaterial(mesh.faces, mat);
                    RebuildMesh(mesh);
                    inlineMat = mat;
                }
            }

            // Select the new object
            Selection.activeGameObject = mesh.gameObject;

            Debug.Log($"🔧 ProBuilder: Created {shapeType} '{mesh.gameObject.name}' " +
                      $"(faces={mesh.faceCount}, verts={mesh.vertexCount}" +
                      $"{(inlineMat != null ? $", material={inlineMat.name}" : "")})");

            var createResult = MeshResult("create_shape", mesh);
            if (inlineMat != null)
            {
                createResult.materialInstanceId = inlineMat.GetInstanceID();
                createResult.materialAssetPath = AssetDatabase.GetAssetPath(inlineMat);
            }
            return createResult;
        }
        catch (Exception ex)
        {
            return Fail("create_shape", ex.Message);
        }
    }

    // =========================================================================
    // ACTION: create_poly_shape
    // =========================================================================

    /// <summary>
    /// Create a ProBuilder mesh from a polygon outline extruded to a height.
    ///
    /// Required params:
    ///   points (float[][])  — At least 3 points as [x,y,z] or [x,z] (y defaults to 0)
    ///
    /// Optional params:
    ///   extrude (float)        — Extrusion height (default 1.0)
    ///   flipNormals (bool)     — Reverse winding (default false)
    ///   name (string)          — GameObject name (default "PolyShape")
    ///   position ([x,y,z])     — World position
    ///   components (string[])  — Component types to add inline
    ///   material               — Inline material (same 3 formats as create_shape)
    ///
    /// Returns: ProBuilderResult with instanceId, mesh stats, optional material info
    /// </summary>
    public static ProBuilderResult CreatePolyShape(JObject body)
    {
        try
        {
            var pointsArr = body?["points"]?.ToObject<float[][]>();
            if (pointsArr == null || pointsArr.Length < 3)
                return Fail("create_poly_shape", "points requires array of at least 3 [x, z] or [x, y, z] points");

            float extrude = body?["extrude"]?.ToObject<float>() ?? 1f;
            bool flipNormals = body?["flipNormals"]?.ToObject<bool>() ?? false;
            string goName = body?["name"]?.ToString();
            float[] position = body?["position"]?.ToObject<float[]>();

            // Convert to Vector3 points
            var points = new List<Vector3>();
            foreach (var pt in pointsArr)
            {
                if (pt.Length >= 3)
                    points.Add(new Vector3(pt[0], pt[1], pt[2]));
                else if (pt.Length >= 2)
                    points.Add(new Vector3(pt[0], 0, pt[1]));
                else
                    return Fail("create_poly_shape", "Each point must have at least 2 values [x, z] or 3 values [x, y, z]");
            }

            // Create a new ProBuilder mesh and shape from polygon
            var mesh = ProBuilderMesh.Create();
            mesh.CreateShapeFromPolygon(points, extrude, flipNormals);

            RebuildMesh(mesh);

            if (!string.IsNullOrEmpty(goName))
                mesh.gameObject.name = goName;
            else
                mesh.gameObject.name = "PolyShape";

            if (position != null && position.Length >= 3)
                mesh.transform.localPosition = new Vector3(position[0], position[1], position[2]);

            Undo.RegisterCreatedObjectUndo(mesh.gameObject, "Create ProBuilder Poly Shape");

            // Apply inline components
            ApplyInlineComponents(mesh.gameObject, body?["components"]);

            // Apply inline material
            var matToken = body?["material"];
            Material inlineMat = null;
            if (matToken != null)
            {
                var (mat, matError) = ResolveMaterialToken(matToken);
                if (matError != null)
                {
                    var partialResult = MeshResult("create_poly_shape", mesh);
                    partialResult.error = $"Shape created but material failed: {matError}";
                    return partialResult;
                }
                if (mat != null)
                {
                    Undo.RecordObject(mesh.GetComponent<Renderer>(), "Set ProBuilder PolyShape Material");
                    mesh.SetMaterial(mesh.faces, mat);
                    RebuildMesh(mesh);
                    inlineMat = mat;
                }
            }

            Selection.activeGameObject = mesh.gameObject;

            Debug.Log($"🔧 ProBuilder: Created poly shape '{mesh.gameObject.name}' from {points.Count} points " +
                      $"(faces={mesh.faceCount}, verts={mesh.vertexCount}" +
                      $"{(inlineMat != null ? $", material={inlineMat.name}" : "")})");

            var polyResult = MeshResult("create_poly_shape", mesh);
            if (inlineMat != null)
            {
                polyResult.materialInstanceId = inlineMat.GetInstanceID();
                polyResult.materialAssetPath = AssetDatabase.GetAssetPath(inlineMat);
            }
            return polyResult;
        }
        catch (Exception ex)
        {
            return Fail("create_poly_shape", ex.Message);
        }
    }
}
#endif
