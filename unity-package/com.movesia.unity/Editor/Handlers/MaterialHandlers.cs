#if UNITY_EDITOR
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

/// <summary>
/// Handles material operations: material (unified endpoint) and list_shaders.
/// </summary>
internal static class MaterialHandlers
{
    // --- Material endpoint: canonical field names ---
    private static readonly Dictionary<string, string> MaterialCanonicalMap =
        new Dictionary<string, string>
    {
        // instanceId
        { "instanceid",             "instanceId" },
        { "materialinstanceid",     "instanceId" },
        { "matinstanceid",          "instanceId" },
        { "id",                     "instanceId" },

        // assetPath
        { "assetpath",              "assetPath" },
        { "materialpath",           "assetPath" },
        { "matpath",                "assetPath" },
        { "path",                   "assetPath" },

        // shaderName
        { "shadername",             "shaderName" },
        { "shader",                 "shaderName" },
        { "shadertype",             "shaderName" },

        // name
        { "name",                   "name" },
        { "materialname",           "name" },
        { "matname",                "name" },

        // savePath
        { "savepath",               "savePath" },
        { "outputpath",             "savePath" },
        { "filepath",               "savePath" },
        { "saveto",                 "savePath" },

        // properties
        { "properties",             "properties" },
        { "props",                  "properties" },
        { "params",                 "properties" },
        { "parameters",             "properties" },
        { "materialproperties",     "properties" },

        // keywords
        { "keywords",               "keywords" },
        { "keyword",                "keywords" },
        { "shaderkeywords",         "keywords" },

        // assignTo
        { "assignto",               "assignTo" },
        { "assign",                 "assignTo" },
        { "assigntarget",           "assignTo" },
        { "target",                 "assignTo" },
        { "attach",                 "assignTo" },
        { "attachto",               "assignTo" },
        { "applyto",                "assignTo" },
    };

    // --- list_shaders endpoint: canonical field names ---
    private static readonly Dictionary<string, string> ListShadersCanonicalMap =
        new Dictionary<string, string>
    {
        { "filter",                 "filter" },
        { "search",                 "filter" },
        { "query",                  "filter" },
        { "name",                   "filter" },

        { "includeproperties",      "includeProperties" },
        { "withproperties",         "includeProperties" },
        { "showproperties",         "includeProperties" },
        { "properties",             "includeProperties" },

        { "limit",                  "limit" },
        { "max",                    "limit" },
        { "count",                  "limit" },
        { "maxresults",             "limit" },
    };

    /// <summary>
    /// Unified smart material endpoint. Determines action from what's provided:
    ///   - No instanceId/assetPath -> create new material
    ///   - instanceId or assetPath -> load existing material
    ///   - properties/keywords present -> modify the material
    ///   - assignTo present -> assign to a GameObject's Renderer
    /// </summary>
    internal static async Task HandleMaterial(string requestId, JToken body)
    {
        // Normalize all field names to protect against LLM hallucination
        var b = MessageRouter.NormalizeKeys(body, MaterialCanonicalMap, MessageRouter.MaterialNestedKeys);

        int instanceId = b?["instanceId"]?.ToObject<int>() ?? 0;
        string assetPath = b?["assetPath"]?.ToString();
        string shaderName = b?["shaderName"]?.ToString();
        string materialName = b?["name"]?.ToString();
        string savePath = b?["savePath"]?.ToString();

        // Parse properties (keys inside properties are NOT normalized here —
        // MaterialManager.ResolvePropertyName handles alias resolution for those)
        Dictionary<string, JToken> properties = null;
        JObject propsObj = b?["properties"] as JObject;
        if (propsObj != null && propsObj.Count > 0)
        {
            properties = new Dictionary<string, JToken>();
            foreach (var prop in propsObj)
            {
                properties[prop.Key] = prop.Value;
            }
        }

        // Parse keywords — accept both array (enable list) and object (toggle map)
        Dictionary<string, bool> keywords = null;
        var kwToken = b?["keywords"];
        if (kwToken != null)
        {
            keywords = new Dictionary<string, bool>();
            if (kwToken.Type == JTokenType.Array)
            {
                // ["_EMISSION", "_NORMALMAP"] → all enabled
                foreach (var kw in kwToken.ToObject<string[]>())
                {
                    keywords[kw] = true;
                }
            }
            else if (kwToken.Type == JTokenType.Object)
            {
                // { "_EMISSION": true, "_NORMALMAP": false }
                foreach (var kw in (JObject)kwToken)
                {
                    keywords[kw.Key] = kw.Value.ToObject<bool>();
                }
            }
        }

        // Parse assignTo (already normalized by NormalizeKeys recursive handling)
        int assignToGameObject = 0;
        int assignSlotIndex = 0;
        JToken assignToToken = b?["assignTo"];
        if (assignToToken != null && assignToToken.Type == JTokenType.Object)
        {
            assignToGameObject = assignToToken["gameObjectInstanceId"]?.ToObject<int>() ?? 0;
            assignSlotIndex = assignToToken["slotIndex"]?.ToObject<int>() ?? 0;
        }

        var result = MaterialManager.ManageMaterial(
            instanceId: instanceId,
            assetPath: assetPath,
            shaderName: shaderName,
            materialName: materialName,
            savePath: savePath,
            properties: properties,
            keywords: keywords,
            assignToGameObject: assignToGameObject,
            assignSlotIndex: assignSlotIndex
        );

        await MessageRouter.SendResponse(requestId, "material_result", result);
    }

    /// <summary>
    /// List available shaders with their properties.
    /// </summary>
    internal static async Task HandleListShaders(string requestId, JToken body)
    {
        // Normalize field names to protect against LLM hallucination
        var b = MessageRouter.NormalizeKeys(body, ListShadersCanonicalMap);

        string filter = b?["filter"]?.ToString();
        bool includeProperties = b?["includeProperties"]?.ToObject<bool>() ?? true;
        int limit = b?["limit"]?.ToObject<int>() ?? 50;

        var result = MaterialManager.ListShaders(filter, includeProperties, limit);
        await MessageRouter.SendResponse(requestId, "shaders_list", result);
    }
}
#endif
