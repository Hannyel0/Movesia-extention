#if UNITY_EDITOR
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.ProBuilder;
using UnityEditor;
using Newtonsoft.Json.Linq;

/// <summary>
/// Handler for the unified "probuilder" WebSocket message type.
///
/// ARCHITECTURE:
///   Lives in a separate assembly (Movesia.Connection.Editor.ProBuilder) that only compiles
///   when com.unity.probuilder is installed (via defineConstraints + versionDefines).
///   Registers itself with MessageRouter via [InitializeOnLoad] static constructor so the
///   main assembly never needs to reference this optional assembly directly.
///
/// MESSAGE FORMAT:
///   {"type": "probuilder", "id": "req-1", "body": {"action": "...", ...params}}
///
/// DISPATCH:
///   The "action" field is normalized (lowercase + strip underscores) and dispatched to
///   the corresponding ProBuilderManager method. Supports fuzzy action names:
///   e.g. "create_shape", "CreateShape", "create-shape" all work.
///
/// FUZZY KEY NORMALIZATION:
///   The ProBuilderCanonicalMap below maps ~190 common misspellings/variations to canonical
///   field names. This protects against LLM hallucination of field names. The normalization
///   strips underscores and lowercases before lookup. Unknown keys pass through unchanged.
///
/// 16 ACTIONS:
///   create_shape, create_poly_shape, get_mesh_info, extrude, set_face_material,
///   set_face_color, delete_faces, flip_normals, set_pivot, bevel, bridge,
///   connect_edges, merge, subdivide, query_face_selection, pipeline
///
/// RESPONSE: All actions respond with "probuilder_result" message type.
/// </summary>
[InitializeOnLoad]
internal static class ProBuilderHandlers
{
    static ProBuilderHandlers()
    {
        MessageRouter.RegisterHandler("probuilder", HandleProBuilder);
        SpatialContextManager.ProBuilderEnrichment = EnrichWithProBuilderData;
    }

    /// <summary>
    /// Enrichment callback for get_spatial_context: if the GameObject has a
    /// ProBuilderMesh component, populate face/vertex/edge counts.
    /// </summary>
    private static void EnrichWithProBuilderData(
        GameObject go, SpatialContextManager.SpatialObjectData data)
    {
        var pbMesh = go.GetComponent<ProBuilderMesh>();
        if (pbMesh == null) return;

        data.isProBuilder = true;
        data.faceCount = pbMesh.faceCount;
        data.vertexCount = pbMesh.vertexCount;
        data.edgeCount = pbMesh.faces.Sum(f => f.edges.Count);
    }

    // --- ProBuilder endpoint: canonical field names ---
    // Maps fuzzy/alternative field names to canonical camelCase names.
    // Algorithm: strip underscores + lowercase → lookup → rename to canonical.
    // Unknown keys pass through unchanged (important for shape-specific params).
    private static readonly Dictionary<string, string> ProBuilderCanonicalMap =
        new Dictionary<string, string>
    {
        // action
        { "action",                "action" },
        { "operation",             "action" },
        { "op",                    "action" },
        { "command",               "action" },

        // instanceId (for operations on existing meshes)
        { "instanceid",            "instanceId" },
        { "gameobjectinstanceid",  "instanceId" },
        { "goinstanceid",          "instanceId" },
        { "meshinstanceid",        "instanceId" },
        { "objectid",              "instanceId" },
        { "id",                    "instanceId" },

        // shapeType
        { "shapetype",             "shapeType" },
        { "shape",                 "shapeType" },
        { "meshtype",              "shapeType" },
        { "primitivetype",         "shapeType" },

        // size
        { "size",                  "size" },
        { "dimensions",            "size" },

        // position
        { "position",              "position" },
        { "pos",                   "position" },
        { "worldposition",         "position" },

        // rotation
        { "rotation",              "rotation" },
        { "rot",                   "rotation" },
        { "eulerangles",           "rotation" },
        { "eulerrotation",         "rotation" },

        // name
        { "name",                  "name" },
        { "gameobjectname",        "name" },
        { "goname",                "name" },
        { "objectname",            "name" },

        // faceSelection
        { "faceselection",         "faceSelection" },
        { "faces",                 "faceSelection" },
        { "selectfaces",           "faceSelection" },
        { "selection",             "faceSelection" },

        // distance (for extrude, bevel)
        { "distance",              "distance" },
        { "amount",                "distance" },
        { "extrudedistance",       "distance" },

        // extrudeMethod
        { "extrudemethod",         "extrudeMethod" },
        { "method",                "extrudeMethod" },
        { "extrudetype",           "extrudeMethod" },

        // material (for set_face_material)
        { "material",              "material" },
        { "materialinstanceid",    "material" },
        { "matinstanceid",         "material" },
        { "materialid",            "material" },

        // color (for set_face_color)
        { "color",                 "color" },
        { "vertexcolor",           "color" },
        { "facecolor",             "color" },

        // instanceIds (for merge)
        { "instanceids",           "instanceIds" },
        { "meshes",                "instanceIds" },
        { "targets",               "instanceIds" },

        // deleteOriginals (for merge)
        { "deleteoriginals",       "deleteOriginals" },
        { "destroyoriginals",      "deleteOriginals" },
        { "removesource",          "deleteOriginals" },

        // pivotLocation (for set_pivot)
        { "pivotlocation",         "pivotLocation" },
        { "pivot",                 "pivotLocation" },
        { "pivotpoint",            "pivotLocation" },
        { "pivotposition",         "pivotLocation" },

        // edgeA, edgeB (for bridge)
        { "edgea",                 "edgeA" },
        { "edge1",                 "edgeA" },
        { "firstedge",             "edgeA" },
        { "edgeb",                 "edgeB" },
        { "edge2",                 "edgeB" },
        { "secondedge",            "edgeB" },

        // get_mesh_info params
        { "includefacedetails",    "includeFaceDetails" },
        { "includefaces",          "includeFaceDetails" },
        { "facedetails",           "includeFaceDetails" },
        { "detailed",              "includeFaceDetails" },
        { "maxfaces",              "maxFaces" },
        { "facelimit",             "maxFaces" },

        // Shape-specific params
        { "radius",                "radius" },
        { "height",                "height" },
        { "width",                 "width" },
        { "depth",                 "depth" },
        { "steps",                 "steps" },
        { "sides",                 "sides" },
        { "thickness",             "thickness" },
        { "subdivisions",          "subdivisions" },
        { "subdivaxis",            "subdivAxis" },
        { "subdivheight",          "subdivHeight" },
        { "heightcuts",            "heightCuts" },
        { "widthcuts",             "widthCuts" },
        { "smooth",                "smooth" },
        { "smoothing",             "smooth" },
        { "buildsides",            "buildSides" },
        { "angle",                 "angle" },
        { "innerradius",           "innerRadius" },
        { "outerradius",           "outerRadius" },
        { "rows",                  "rows" },
        { "columns",               "columns" },
        { "circumference",         "circumference" },
        { "stairwidth",            "stairWidth" },
        { "totalwidth",            "totalWidth" },
        { "totalheight",           "totalHeight" },
        { "ledgeheight",           "ledgeHeight" },
        { "legwidth",              "legWidth" },
        { "radialcuts",            "radialCuts" },
        { "insidefaces",           "insideFaces" },
        { "outsidefaces",          "outsideFaces" },
        { "frontfaces",            "frontFaces" },
        { "backfaces",             "backFaces" },
        { "endcaps",               "endCaps" },

        // Poly shape params
        { "points",                "points" },
        { "controlpoints",         "points" },
        { "vertices",              "points" },
        { "extrude",               "extrude" },
        { "extrudeheight",         "extrude" },
        { "flipnormals",           "flipNormals" },

        // Face selection sub-object fields (when at top level)
        { "direction",             "direction" },
        { "threshold",             "threshold" },
        { "dotthreshold",          "threshold" },
        { "faceindices",           "faceIndices" },
        { "indices",               "faceIndices" },

        // Inline components (for create_shape, create_poly_shape)
        { "components",            "components" },
        { "addcomponents",         "components" },

        // Inline scale (for create_shape)
        { "scale",                 "scale" },
        { "localscale",            "scale" },

        // Post-extrude styling (for extrude)
        { "resultcolor",           "resultColor" },
        { "extrudecolor",          "resultColor" },
        { "resultmaterial",        "resultMaterial" },
        { "extrudematerial",       "resultMaterial" },

        // Pipeline steps (note: "steps" key already mapped above for stair steps param —
        // both share the same JToken body key, context determines usage)
        { "pipelinesteps",         "steps" },
        { "operations",            "steps" },
        { "ops",                   "steps" },
    };

    /// <summary>
    /// Unified ProBuilder endpoint. Dispatches by "action" field to the appropriate ProBuilderManager method.
    /// Action names are normalized (lowercase + strip underscores) for fuzzy matching.
    /// Some actions have multiple aliases (e.g. "query_face_selection" also matches "query_faces",
    /// "preview_selection"; "pipeline" also matches "batch", "multi_step").
    /// </summary>
    internal static async Task HandleProBuilder(string requestId, JToken body)
    {
        var b = MessageRouter.NormalizeKeys(body, ProBuilderCanonicalMap);
        string action = b?["action"]?.ToString();

        if (string.IsNullOrEmpty(action))
        {
            await MessageRouter.SendResponse(requestId, "probuilder_result", new
            {
                success = false,
                error = "action is required. Valid actions: create_shape, create_poly_shape, get_mesh_info, " +
                        "extrude, set_face_material, set_face_color, delete_faces, flip_normals, set_pivot, " +
                        "bevel, bridge, connect_edges, merge, subdivide, query_face_selection, pipeline"
            });
            return;
        }

        // Normalize action: strip underscores + lowercase for fuzzy matching
        string normalizedAction = action.ToLowerInvariant().Replace("_", "");

        object result;
        switch (normalizedAction)
        {
            case "createshape":
                result = ProBuilderManager.CreateShape(b);
                break;
            case "createpolyshape":
                result = ProBuilderManager.CreatePolyShape(b);
                break;
            case "getmeshinfo":
                result = ProBuilderManager.GetMeshInfo(b);
                break;
            case "extrude":
                result = ProBuilderManager.Extrude(b);
                break;
            case "setfacematerial":
                result = ProBuilderManager.SetFaceMaterial(b);
                break;
            case "setfacecolor":
                result = ProBuilderManager.SetFaceColor(b);
                break;
            case "deletefaces":
                result = ProBuilderManager.DeleteFaces(b);
                break;
            case "flipnormals":
                result = ProBuilderManager.FlipNormals(b);
                break;
            case "setpivot":
                result = ProBuilderManager.SetPivot(b);
                break;
            case "bevel":
                result = ProBuilderManager.BevelEdges(b);
                break;
            case "bridge":
                result = ProBuilderManager.Bridge(b);
                break;
            case "connectedges":
                result = ProBuilderManager.ConnectEdges(b);
                break;
            case "merge":
                result = ProBuilderManager.MergeMeshes(b);
                break;
            case "subdivide":
                result = ProBuilderManager.Subdivide(b);
                break;
            case "queryfaceselection":
            case "queryfaces":
            case "previewselection":
                result = ProBuilderManager.QueryFaceSelection(b);
                break;
            case "pipeline":
            case "batch":
            case "multistep":
                result = ProBuilderManager.ExecutePipeline(b);
                break;
            default:
                result = new ProBuilderManager.ProBuilderResult
                {
                    success = false,
                    error = $"Unknown action: '{action}'. Valid actions: create_shape, create_poly_shape, " +
                            "get_mesh_info, extrude, set_face_material, set_face_color, delete_faces, " +
                            "flip_normals, set_pivot, bevel, bridge, connect_edges, merge, subdivide, " +
                            "query_face_selection, pipeline"
                };
                break;
        }

        await MessageRouter.SendResponse(requestId, "probuilder_result", result);
    }
}
#endif
