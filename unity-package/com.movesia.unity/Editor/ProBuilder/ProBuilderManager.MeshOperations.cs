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
/// Mesh-level operations for ProBuilderManager:
///   get_mesh_info, set_pivot, bridge, connect_edges, merge, query_face_selection
///
/// These operate on the mesh as a whole or provide inspection/query capabilities.
/// </summary>
public static partial class ProBuilderManager
{
    // =========================================================================
    // ACTION: get_mesh_info
    // =========================================================================

    /// <summary>
    /// Inspect a ProBuilder mesh: face/vertex/edge counts, bounds, and optional per-face details.
    ///
    /// Required: instanceId (int)
    /// Optional:
    ///   includeFaceDetails (bool, default true) — Set false for summary mode (no per-face data)
    ///   maxFaces (int, default 100)             — Cap face detail array to avoid context bloat
    ///
    /// Returns: MeshInfoResult with bounds, counts, and faces[] (if includeFaceDetails=true)
    /// </summary>
    public static MeshInfoResult GetMeshInfo(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return new MeshInfoResult { success = false, error = findError, action = "get_mesh_info" };

            bool includeFaceDetails = body?["includeFaceDetails"]?.ToObject<bool>() ?? true;
            int maxFaces = body?["maxFaces"]?.ToObject<int>() ?? 100;

            var bounds = mesh.GetComponent<MeshFilter>()?.sharedMesh?.bounds ?? new Bounds();

            var result = new MeshInfoResult
            {
                success = true,
                action = "get_mesh_info",
                instanceId = mesh.gameObject.GetInstanceID(),
                name = mesh.gameObject.name,
                faceCount = mesh.faceCount,
                vertexCount = mesh.vertexCount,
                edgeCount = mesh.faces.Sum(f => f.edges.Count),
                boundsCenter = new float[] { bounds.center.x, bounds.center.y, bounds.center.z },
                boundsSize = new float[] { bounds.size.x, bounds.size.y, bounds.size.z },
                totalFaces = mesh.faceCount
            };

            if (includeFaceDetails)
            {
                var faceInfos = new List<FaceInfo>();
                var faces = mesh.faces;
                int limit = Mathf.Min(faces.Count, maxFaces);

                for (int i = 0; i < limit; i++)
                {
                    Vector3 n = Math.Normal(mesh, faces[i]);
                    faceInfos.Add(new FaceInfo
                    {
                        index = i,
                        normal = new float[] { n.x, n.y, n.z },
                        vertexCount = faces[i].distinctIndexes.Count,
                        materialIndex = faces[i].submeshIndex
                    });
                }

                result.faces = faceInfos.ToArray();
                result.truncated = faces.Count > maxFaces;
            }

            return result;
        }
        catch (Exception ex)
        {
            return new MeshInfoResult { success = false, error = ex.Message, action = "get_mesh_info" };
        }
    }

    // =========================================================================
    // ACTION: set_pivot
    // =========================================================================

    /// <summary>
    /// Move the pivot point of a ProBuilder mesh.
    /// Required: instanceId
    /// Optional: pivotLocation — "center" (default), "firstVertex", or [x,y,z] world position.
    ///           When using [x,y,z], vertices are offset so the mesh doesn't visually move.
    /// </summary>
    public static ProBuilderResult SetPivot(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return Fail("set_pivot", findError);

            var pivotToken = body?["pivotLocation"];
            string pivotStr = pivotToken?.ToString()?.ToLowerInvariant().Replace("_", "") ?? "center";

            Undo.RecordObject(mesh.transform, "Set ProBuilder Pivot");
            Undo.RecordObject(mesh, "Set ProBuilder Pivot");

            switch (pivotStr)
            {
                case "center":
                    mesh.CenterPivot(null);
                    break;

                case "firstvertex":
                case "first":
                {
                    // Pivot to first vertex position
                    if (mesh.positions.Count > 0)
                    {
                        var indices = new int[] { 0 };
                        mesh.CenterPivot(indices);
                    }
                    break;
                }

                default:
                {
                    // Try parsing as [x, y, z] world position
                    if (pivotToken != null && pivotToken.Type == JTokenType.Array)
                    {
                        var posArr = pivotToken.ToObject<float[]>();
                        if (posArr != null && posArr.Length >= 3)
                        {
                            Vector3 targetWorldPos = new Vector3(posArr[0], posArr[1], posArr[2]);
                            Vector3 currentPos = mesh.transform.position;
                            Vector3 offset = currentPos - targetWorldPos;

                            // Move vertices in the opposite direction of the pivot move
                            var positions = mesh.positions.ToArray();
                            for (int i = 0; i < positions.Length; i++)
                            {
                                positions[i] += offset;
                            }
                            mesh.positions = positions;
                            mesh.transform.position = targetWorldPos;

                            RebuildMesh(mesh);

                            Debug.Log($"🔧 ProBuilder: Set pivot of '{mesh.gameObject.name}' to ({posArr[0]}, {posArr[1]}, {posArr[2]})");
                            return MeshResult("set_pivot", mesh);
                        }
                    }

                    return Fail("set_pivot", $"Invalid pivotLocation: '{pivotToken}'. " +
                        "Valid: 'center', 'firstVertex', or [x, y, z] array");
                }
            }

            RebuildMesh(mesh);

            Debug.Log($"🔧 ProBuilder: Set pivot of '{mesh.gameObject.name}' to {pivotStr}");

            return MeshResult("set_pivot", mesh);
        }
        catch (Exception ex)
        {
            return Fail("set_pivot", ex.Message);
        }
    }

    // =========================================================================
    // ACTION: bridge
    // =========================================================================

    /// <summary>
    /// Create a new face between two edges (specified by vertex index pairs).
    /// Useful for connecting gaps in a mesh. Use get_mesh_info to find vertex indices.
    /// Required: instanceId, edgeA ([v0, v1]), edgeB ([v0, v1])
    /// </summary>
    public static FaceOperationResult Bridge(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return FaceOpFail("bridge", findError);

            // Parse edgeA and edgeB as {v0, v1} vertex index pairs
            var edgeAToken = body?["edgeA"];
            var edgeBToken = body?["edgeB"];

            if (edgeAToken == null || edgeBToken == null)
                return FaceOpFail("bridge", "edgeA and edgeB are required. Each should be [vertexIndex0, vertexIndex1]");

            Edge edgeA, edgeB;

            var aArr = edgeAToken.ToObject<int[]>();
            if (aArr == null || aArr.Length < 2)
                return FaceOpFail("bridge", "edgeA must be [vertexIndex0, vertexIndex1]");
            edgeA = new Edge(aArr[0], aArr[1]);

            var bArr = edgeBToken.ToObject<int[]>();
            if (bArr == null || bArr.Length < 2)
                return FaceOpFail("bridge", "edgeB must be [vertexIndex0, vertexIndex1]");
            edgeB = new Edge(bArr[0], bArr[1]);

            Undo.RecordObject(mesh, "Bridge ProBuilder Edges");

            Face newFace = mesh.Bridge(edgeA, edgeB);

            if (newFace == null)
                return FaceOpFail("bridge", "Bridge failed — edges may not be valid or bridgeable");

            RebuildMesh(mesh);

            Debug.Log($"🔧 ProBuilder: Bridged edges on '{mesh.gameObject.name}'");

            return FaceOpResult("bridge", mesh, 1);
        }
        catch (Exception ex)
        {
            return FaceOpFail("bridge", ex.Message);
        }
    }

    // =========================================================================
    // ACTION: connect_edges
    // =========================================================================

    /// <summary>
    /// Subdivide faces by connecting their edges. Collects all edges from selected faces
    /// and inserts new edges connecting midpoints, creating new faces.
    /// Required: instanceId
    /// Optional: faceSelection (default: all). Needs at least 2 edges.
    /// </summary>
    public static FaceOperationResult ConnectEdges(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return FaceOpFail("connect_edges", findError);

            // Collect edges from selected faces
            var (selectedFaces, selError) = SelectFaces(mesh, body?["faceSelection"]);
            if (selError != null)
                return FaceOpFail("connect_edges", selError);

            var edges = selectedFaces.SelectMany(f => f.edges).Distinct().ToList();

            if (edges.Count < 2)
                return FaceOpFail("connect_edges", "At least 2 edges are required for connection");

            Undo.RecordObject(mesh, "Connect ProBuilder Edges");

            var result = mesh.Connect(edges);

            RebuildMesh(mesh);

            int newFaceCount = result.item1 != null ? result.item1.Length : 0;

            Debug.Log($"🔧 ProBuilder: Connected {edges.Count} edges on '{mesh.gameObject.name}' " +
                      $"(created {newFaceCount} new faces)");

            return FaceOpResult("connect_edges", mesh, newFaceCount);
        }
        catch (Exception ex)
        {
            return FaceOpFail("connect_edges", ex.Message);
        }
    }

    // =========================================================================
    // ACTION: merge
    // =========================================================================

    /// <summary>
    /// Combine multiple ProBuilder meshes into one. The first mesh in instanceIds
    /// becomes the target; others are merged into it.
    /// Required: instanceIds (int[]) — at least 2 ProBuilder mesh instanceIds
    /// Optional: deleteOriginals (bool, default true) — destroy source GameObjects after merge
    /// </summary>
    public static ProBuilderResult MergeMeshes(JObject body)
    {
        try
        {
            var instanceIds = body?["instanceIds"]?.ToObject<int[]>();
            if (instanceIds == null || instanceIds.Length < 2)
                return Fail("merge", "instanceIds requires array of at least 2 ProBuilder mesh instanceIds");

            bool deleteOriginals = body?["deleteOriginals"]?.ToObject<bool>() ?? true;

            var meshes = new List<ProBuilderMesh>();
            foreach (int id in instanceIds)
            {
                var go = EditorUtility.EntityIdToObject(id) as GameObject;
                if (go == null)
                    return Fail("merge", $"GameObject with instanceId {id} not found");
                var pbMesh = go.GetComponent<ProBuilderMesh>();
                if (pbMesh == null)
                    return Fail("merge", $"GameObject '{go.name}' (id={id}) has no ProBuilderMesh component");
                meshes.Add(pbMesh);
            }

            // Record all source meshes for undo
            foreach (var m in meshes)
                Undo.RecordObject(m.gameObject, "Merge ProBuilder Meshes");

            var combinedMeshes = CombineMeshes.Combine(meshes, meshes[0]);

            if (combinedMeshes == null || combinedMeshes.Count == 0)
                return Fail("merge", "Merge operation returned no result");

            // Rebuild all combined meshes
            foreach (var cm in combinedMeshes)
            {
                RebuildMesh(cm);
            }

            // Delete original meshes (skip the first one which is the target)
            if (deleteOriginals)
            {
                for (int i = 1; i < meshes.Count; i++)
                {
                    if (meshes[i] != null && meshes[i].gameObject != null)
                    {
                        Undo.DestroyObjectImmediate(meshes[i].gameObject);
                    }
                }
            }

            var resultMesh = combinedMeshes[0];
            Selection.activeGameObject = resultMesh.gameObject;

            Debug.Log($"🔧 ProBuilder: Merged {meshes.Count} meshes into '{resultMesh.gameObject.name}' " +
                      $"(deleteOriginals={deleteOriginals})");

            return MeshResult("merge", resultMesh);
        }
        catch (Exception ex)
        {
            return Fail("merge", ex.Message);
        }
    }

    // =========================================================================
    // ACTION: query_face_selection (read-only preview)
    // =========================================================================

    /// <summary>
    /// Preview which faces match a selection without mutating the mesh.
    /// Allows the agent to validate face selection parameters before committing to an operation.
    ///
    /// Required: instanceId (int), faceSelection (object or string)
    /// Returns: FaceSelectionQueryResult with matched face indices, normals, vertex counts
    /// </summary>
    public static FaceSelectionQueryResult QueryFaceSelection(JObject body)
    {
        try
        {
            var (mesh, findError) = FindProBuilderMesh(body);
            if (findError != null)
                return new FaceSelectionQueryResult { success = false, error = findError, action = "query_face_selection" };

            var faceSelToken = body?["faceSelection"];
            if (faceSelToken == null)
                return new FaceSelectionQueryResult { success = false, error = "faceSelection is required", action = "query_face_selection" };

            var (selectedFaces, selError) = SelectFaces(mesh, faceSelToken);
            if (selError != null)
                return new FaceSelectionQueryResult { success = false, error = selError, action = "query_face_selection" };

            // Build face info for matched faces
            var allFaces = mesh.faces;
            var faceInfos = new List<FaceInfo>();
            foreach (var face in selectedFaces)
            {
                int idx = allFaces.IndexOf(face);
                Vector3 n = Math.Normal(mesh, face);
                faceInfos.Add(new FaceInfo
                {
                    index = idx,
                    normal = new float[] { n.x, n.y, n.z },
                    vertexCount = face.distinctIndexes.Count,
                    materialIndex = face.submeshIndex
                });
            }

            Debug.Log($"🔧 ProBuilder: Face selection query on '{mesh.gameObject.name}': " +
                      $"{selectedFaces.Count}/{allFaces.Count} faces matched");

            return new FaceSelectionQueryResult
            {
                success = true,
                action = "query_face_selection",
                instanceId = mesh.gameObject.GetInstanceID(),
                name = mesh.gameObject.name,
                matchedFaces = selectedFaces.Count,
                totalFaces = allFaces.Count,
                faces = faceInfos.ToArray()
            };
        }
        catch (Exception ex)
        {
            return new FaceSelectionQueryResult { success = false, error = ex.Message, action = "query_face_selection" };
        }
    }
}
#endif
