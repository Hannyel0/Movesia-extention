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
/// Unified ProBuilder operations for the AI agent.
/// Single smart endpoint: provide an action + parameters, get results back.
///
/// This is a partial class split across multiple files for maintainability:
///   ProBuilderManager.cs              — Data structures + helper methods
///   ProBuilderManager.FaceSelection.cs — Face selection system (direction, index, all)
///   ProBuilderManager.ShapeCreation.cs — create_shape, create_poly_shape
///   ProBuilderManager.FaceOperations.cs — extrude, set_face_material, set_face_color,
///                                         delete_faces, flip_normals, subdivide, bevel
///   ProBuilderManager.MeshOperations.cs — get_mesh_info, set_pivot, bridge, connect_edges,
///                                         merge, query_face_selection
///   ProBuilderManager.Pipeline.cs      — pipeline (multi-step with single rebuild)
///
/// ═══════════════════════════════════════════════════════════════════════
/// 16 ACTIONS via unified "probuilder" message type:
/// ═══════════════════════════════════════════════════════════════════════
///
/// SHAPE CREATION:
///   create_shape       — Create one of 12 primitive shapes (Cube, Cylinder, Cone, Plane, Pipe,
///                        Arch, Stair, CurvedStair, Door, Torus, Icosahedron, Prism).
///                        Supports inline material, components, position, rotation, scale.
///   create_poly_shape  — Create mesh from polygon outline + extrude height.
///                        Supports inline material and components.
///
/// MESH INSPECTION:
///   get_mesh_info          — Read face/vertex/edge counts, bounds, and optional per-face details.
///                            Supports maxFaces cap and includeFaceDetails toggle for large meshes.
///   query_face_selection   — Read-only: preview which faces match a selection without mutating.
///                            Lets the agent validate threshold/direction before committing.
///
/// FACE OPERATIONS:
///   extrude            — Extrude faces outward/inward. Supports post-extrude resultColor and
///                        resultMaterial so agent doesn't need follow-up calls to style new faces.
///   set_face_material  — Assign material to selected faces. Accepts inline material creation
///                        via {create:true, properties:{...}} or existing ref (instanceId/assetPath).
///   set_face_color     — Set vertex color on selected faces.
///   delete_faces       — Remove selected faces from mesh.
///   flip_normals       — Reverse face winding (inside-out).
///   subdivide          — Split faces by connecting edge midpoints to face center.
///   bevel              — Bevel edges of selected faces.
///
/// MESH-LEVEL OPERATIONS:
///   set_pivot       — Move pivot to center, first vertex, or custom [x,y,z].
///   bridge          — Create face between two edges (by vertex indices).
///   connect_edges   — Subdivide faces by connecting edges.
///   merge           — Combine multiple ProBuilder meshes into one. Optional deleteOriginals.
///
/// COMPOUND OPERATIONS:
///   pipeline         — Execute N operations on a single mesh with only ONE RebuildMesh at the end.
///                      Avoids redundant ToMesh/Refresh/Optimize cycles. Steps support:
///                      extrude, subdivide, delete_faces, flip_normals, set_face_material,
///                      set_face_color, bevel. Each step has per-step error reporting.
///
/// ═══════════════════════════════════════════════════════════════════════
/// INLINE MATERIAL SYSTEM (ResolveMaterialToken):
/// ═══════════════════════════════════════════════════════════════════════
/// Wherever "material" is accepted, three formats work:
///   1. int           → instanceId lookup
///   2. string        → asset path lookup (auto-prepends "Assets/" if needed)
///   3. object        → {create:true, shaderName?, name?, savePath?, properties:{...}}
///                      Creates a new material via MaterialManager.ManageMaterial() inline.
///                      Or: {instanceId: 123} / {assetPath: "Assets/..."} for explicit refs.
///
/// ═══════════════════════════════════════════════════════════════════════
/// FACE SELECTION SYSTEM (SelectFaces):
/// ═══════════════════════════════════════════════════════════════════════
/// Three methods to select faces:
///   1. "all"         → all faces (default when faceSelection omitted)
///   2. Direction      → dot product of face normal vs direction. Shorthand: "up", "down", etc.
///                      Full form: {method:"direction", direction:"up"|[x,y,z], threshold:0.7}
///   3. Index          → {method:"index", indices:[0,1,5]}
///
/// ═══════════════════════════════════════════════════════════════════════
/// REBUILD PATTERN:
/// ═══════════════════════════════════════════════════════════════════════
/// Every mesh modification MUST call RebuildMesh() which runs:
///   mesh.ToMesh() → mesh.Refresh() → EditorMeshUtility.Optimize(mesh)
/// The pipeline action optimizes this by deferring rebuild to end (1 call vs N).
/// </summary>
public static partial class ProBuilderManager
{
    // =========================================================================
    // DATA STRUCTURES
    // =========================================================================

    /// <summary>
    /// Standard result for shape creation, merge, set_pivot, and other mesh-level actions.
    /// Contains mesh stats + optional material info when inline material was used.
    /// </summary>
    [Serializable]
    public class ProBuilderResult
    {
        public bool success;
        public string error;
        public string action;          // e.g. "create_shape", "merge", "set_pivot"
        public int instanceId;         // GameObject instanceId for stateless follow-up
        public string name;            // GameObject name
        public int faceCount;
        public int vertexCount;
        public int edgeCount;

        // Populated when create_shape/create_poly_shape used inline material
        public int materialInstanceId;
        public string materialAssetPath;
    }

    /// <summary>
    /// Result for get_mesh_info action. Includes bounds and optional per-face detail.
    /// Use includeFaceDetails=false for summary only (avoids large payloads on complex meshes).
    /// Use maxFaces to cap how many face details are returned (default 100).
    /// </summary>
    [Serializable]
    public class MeshInfoResult
    {
        public bool success;
        public string error;
        public string action;          // always "get_mesh_info"
        public int instanceId;
        public string name;
        public int faceCount;
        public int vertexCount;
        public int edgeCount;
        public float[] boundsCenter;   // [x, y, z]
        public float[] boundsSize;     // [w, h, d]
        public bool truncated;         // true if faces array was capped by maxFaces
        public int totalFaces;         // actual face count (may be > faces.Length if truncated)
        public FaceInfo[] faces;       // null when includeFaceDetails=false
    }

    /// <summary>
    /// Per-face info returned by get_mesh_info and query_face_selection.
    /// </summary>
    [Serializable]
    public class FaceInfo
    {
        public int index;              // face index in mesh.faces
        public float[] normal;         // [x, y, z] face normal
        public int vertexCount;        // distinct vertex count for this face
        public int materialIndex;      // submesh/material slot index
    }

    /// <summary>
    /// Result for face-level operations (extrude, set_face_material, set_face_color,
    /// delete_faces, flip_normals, subdivide, bevel, bridge, connect_edges).
    /// Includes how many faces were affected + optional material info if inline material was used.
    /// </summary>
    [Serializable]
    public class FaceOperationResult
    {
        public bool success;
        public string error;
        public string action;          // e.g. "extrude", "set_face_material"
        public int instanceId;         // GameObject instanceId for stateless follow-up
        public string name;
        public int affectedFaces;      // how many faces the operation touched
        public int faceCount;          // total face count after operation
        public int vertexCount;

        // Populated when set_face_material or extrude used inline material creation
        public int materialInstanceId;
        public string materialAssetPath;
    }

    /// <summary>
    /// Result for query_face_selection action. Read-only — no mesh mutation.
    /// Returns which faces match the given selection criteria so the agent can
    /// validate threshold/direction before committing to a destructive operation.
    /// </summary>
    [Serializable]
    public class FaceSelectionQueryResult
    {
        public bool success;
        public string error;
        public string action;          // always "query_face_selection"
        public int instanceId;
        public string name;
        public int matchedFaces;       // how many faces matched the selection
        public int totalFaces;         // total faces on the mesh
        public FaceInfo[] faces;       // detailed info for each matched face
    }

    /// <summary>
    /// Result for pipeline action. Reports per-step success/failure and final mesh stats.
    /// The pipeline executes N operations with only ONE RebuildMesh at the end,
    /// avoiding N redundant ToMesh/Refresh/Optimize cycles.
    /// </summary>
    [Serializable]
    public class PipelineResult
    {
        public bool success;           // true only if ALL steps succeeded
        public string error;           // summary error if any steps failed
        public string action;          // always "pipeline"
        public int instanceId;         // final GameObject instanceId
        public string name;
        public int faceCount;          // final face count after all steps
        public int vertexCount;
        public int edgeCount;
        public int stepsExecuted;      // how many steps succeeded
        public int stepsTotal;         // total steps in the pipeline
        public PipelineStepResult[] stepResults; // per-step results
    }

    /// <summary>
    /// Per-step result within a pipeline. Each step runs independently —
    /// a failed step doesn't block subsequent steps from executing.
    /// </summary>
    [Serializable]
    public class PipelineStepResult
    {
        public int stepIndex;          // 0-based position in the steps array
        public string operation;       // the "op" value from the step (e.g. "extrude")
        public bool success;
        public string error;           // null on success
        public int affectedFaces;      // faces touched by this step (0 if failed)
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    internal static ProBuilderResult Fail(string action, string error)
    {
        return new ProBuilderResult { success = false, action = action, error = error };
    }

    internal static FaceOperationResult FaceOpFail(string action, string error)
    {
        return new FaceOperationResult { success = false, action = action, error = error };
    }

    internal static (ProBuilderMesh mesh, string error) FindProBuilderMesh(JObject body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        if (instanceId == 0)
            return (null, "instanceId is required");

        var go = EditorUtility.EntityIdToObject(instanceId) as GameObject;
        if (go == null)
            return (null, $"GameObject with instanceId {instanceId} not found");

        var mesh = go.GetComponent<ProBuilderMesh>();
        if (mesh == null)
            return (null, $"GameObject '{go.name}' does not have a ProBuilderMesh component");

        return (mesh, null);
    }

    internal static Vector3 ParseVector3(JObject body, string key, Vector3 defaultValue)
    {
        var arr = body?[key]?.ToObject<float[]>();
        if (arr == null || arr.Length < 3)
            return defaultValue;
        return new Vector3(arr[0], arr[1], arr[2]);
    }

    /// <summary>
    /// Mandatory ProBuilder rebuild sequence. Must be called after every mesh modification.
    /// </summary>
    internal static void RebuildMesh(ProBuilderMesh mesh)
    {
        mesh.ToMesh();
        mesh.Refresh();
        EditorMeshUtility.Optimize(mesh);
    }

    internal static ProBuilderResult MeshResult(string action, ProBuilderMesh mesh)
    {
        return new ProBuilderResult
        {
            success = true,
            action = action,
            instanceId = mesh.gameObject.GetInstanceID(),
            name = mesh.gameObject.name,
            faceCount = mesh.faceCount,
            vertexCount = mesh.vertexCount,
            edgeCount = mesh.faces.Sum(f => f.edges.Count)
        };
    }

    internal static FaceOperationResult FaceOpResult(string action, ProBuilderMesh mesh, int affectedFaces,
        Material inlineMaterial = null)
    {
        var result = new FaceOperationResult
        {
            success = true,
            action = action,
            instanceId = mesh.gameObject.GetInstanceID(),
            name = mesh.gameObject.name,
            affectedFaces = affectedFaces,
            faceCount = mesh.faceCount,
            vertexCount = mesh.vertexCount
        };

        if (inlineMaterial != null)
        {
            result.materialInstanceId = inlineMaterial.GetInstanceID();
            result.materialAssetPath = AssetDatabase.GetAssetPath(inlineMaterial);
        }

        return result;
    }

    /// <summary>
    /// Resolve a material reference from a JToken. Accepts:
    /// - int (instanceId)
    /// - string (assetPath)
    /// - object with "create":true + optional shaderName/properties/name/savePath → creates via MaterialManager
    /// Returns (material, error). Error is null on success.
    /// </summary>
    internal static (Material material, string error) ResolveMaterialToken(JToken matToken)
    {
        if (matToken == null)
            return (null, null);

        // Int → instanceId lookup
        if (matToken.Type == JTokenType.Integer)
        {
            int matId = matToken.ToObject<int>();
            var mat = EditorUtility.EntityIdToObject(matId) as Material;
            if (mat == null)
                return (null, $"Material with instanceId {matId} not found");
            return (mat, null);
        }

        // String → asset path lookup
        if (matToken.Type == JTokenType.String)
        {
            string path = matToken.ToString();
            if (!path.StartsWith("Assets"))
                path = "Assets/" + path.TrimStart('/');
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
                return (null, $"Material not found at: {path}");
            return (mat, null);
        }

        // Object → create inline or reference by nested instanceId/assetPath
        if (matToken.Type == JTokenType.Object)
        {
            var matObj = (JObject)matToken;
            bool create = matObj?["create"]?.ToObject<bool>() ?? false;

            if (create)
            {
                // Inline creation via MaterialManager
                string shaderName = matObj?["shaderName"]?.ToString() ?? matObj?["shader"]?.ToString();
                string matName = matObj?["name"]?.ToString();
                string savePath = matObj?["savePath"]?.ToString();

                // Parse properties
                Dictionary<string, JToken> properties = null;
                var propsObj = matObj?["properties"] as JObject;
                if (propsObj != null && propsObj.Count > 0)
                {
                    properties = new Dictionary<string, JToken>();
                    foreach (var prop in propsObj)
                        properties[prop.Key] = prop.Value;
                }

                var result = MaterialManager.ManageMaterial(
                    shaderName: shaderName,
                    materialName: matName,
                    savePath: savePath,
                    properties: properties
                );

                if (!result.success)
                    return (null, $"Inline material creation failed: {result.error}");

                var createdMat = EditorUtility.EntityIdToObject(result.instanceId) as Material;
                if (createdMat == null)
                    return (null, "Inline material was created but could not be resolved");

                return (createdMat, null);
            }

            // Non-create object: try instanceId or assetPath inside it
            int objId = matObj?["instanceId"]?.ToObject<int>() ?? 0;
            if (objId != 0)
            {
                var mat = EditorUtility.EntityIdToObject(objId) as Material;
                if (mat == null)
                    return (null, $"Material with instanceId {objId} not found");
                return (mat, null);
            }

            string objPath = matObj?["assetPath"]?.ToString();
            if (!string.IsNullOrEmpty(objPath))
            {
                if (!objPath.StartsWith("Assets"))
                    objPath = "Assets/" + objPath.TrimStart('/');
                var mat = AssetDatabase.LoadAssetAtPath<Material>(objPath);
                if (mat == null)
                    return (null, $"Material not found at: {objPath}");
                return (mat, null);
            }

            return (null, "material object must contain 'create':true, or 'instanceId', or 'assetPath'");
        }

        return (null, "material must be an instanceId (int), assetPath (string), or object with create/instanceId/assetPath");
    }

    /// <summary>
    /// Apply optional inline components to a ProBuilder GameObject at creation time.
    /// Accepts a JArray of component type name strings, e.g. ["BoxCollider", "Rigidbody"].
    /// Uses same lookup logic as HierarchyManipulator.FindComponentType:
    ///   1. Try UnityEngine.{name} from CoreModule
    ///   2. Fall back to TypeCache search across all loaded assemblies (case-insensitive)
    /// Each component is added with Undo.AddComponent for undo support.
    /// Called by CreateShape and CreatePolyShape when "components" field is present.
    /// </summary>
    internal static void ApplyInlineComponents(GameObject go, JToken componentsToken)
    {
        if (componentsToken == null || componentsToken.Type != JTokenType.Array) return;

        var componentNames = componentsToken.ToObject<string[]>();
        if (componentNames == null) return;

        foreach (var compName in componentNames)
        {
            if (string.IsNullOrEmpty(compName)) continue;

            // Search for the component type by name via TypeCache
            Type compType = null;

            // Try common Unity components first
            compType = Type.GetType($"UnityEngine.{compName}, UnityEngine.CoreModule");
            if (compType != null && typeof(Component).IsAssignableFrom(compType))
            {
                Undo.AddComponent(go, compType);
                continue;
            }

            // Try TypeCache for all components
            var types = TypeCache.GetTypesDerivedFrom<Component>();
            foreach (var t in types)
            {
                if (t.Name.Equals(compName, StringComparison.OrdinalIgnoreCase))
                {
                    Undo.AddComponent(go, t);
                    break;
                }
            }
        }
    }
}
#endif
