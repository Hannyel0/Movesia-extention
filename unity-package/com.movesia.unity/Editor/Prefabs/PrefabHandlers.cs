#if UNITY_EDITOR
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

/// <summary>
/// Handles prefab operations: unified "prefab" endpoint and all legacy prefab messages.
/// </summary>
internal static class PrefabHandlers
{
    // --- Unified prefab endpoint: canonical field names ---
    private static readonly Dictionary<string, string> PrefabCanonicalMap =
        new Dictionary<string, string>
    {
        // instanceId (scene GO for create/apply)
        { "instanceid",             "instanceId" },
        { "gameobjectinstanceid",   "instanceId" },
        { "goinstanceid",           "instanceId" },
        { "objectid",               "instanceId" },
        { "id",                     "instanceId" },

        // assetPath (prefab asset path for instantiate/modify)
        { "assetpath",              "assetPath" },
        { "prefabpath",             "assetPath" },
        { "path",                   "assetPath" },
        { "prefabassetpath",        "assetPath" },

        // prefabName (search-based instantiate)
        { "prefabname",             "prefabName" },
        { "name",                   "prefabName" },
        { "searchname",             "prefabName" },

        // parentInstanceId
        { "parentinstanceid",       "parentInstanceId" },
        { "parentid",               "parentInstanceId" },
        { "parent",                 "parentInstanceId" },

        // position
        { "position",               "position" },
        { "pos",                    "position" },
        { "worldposition",          "position" },
        { "localposition",          "position" },

        // rotation
        { "rotation",               "rotation" },
        { "rot",                    "rotation" },
        { "eulerrotation",          "rotation" },
        { "eulerangles",            "rotation" },

        // scale
        { "scale",                  "scale" },
        { "localscale",             "scale" },

        // savePath (for create from GO)
        { "savepath",               "savePath" },
        { "outputpath",             "savePath" },
        { "saveto",                 "savePath" },

        // componentType (for modify)
        { "componenttype",          "componentType" },
        { "component",              "componentType" },
        { "comptype",               "componentType" },

        // targetPath (for modify — child path within prefab)
        { "targetpath",             "targetPath" },
        { "childpath",              "targetPath" },
        { "target",                 "targetPath" },

        // properties (for modify)
        { "properties",             "properties" },
        { "props",                  "properties" },
        { "params",                 "properties" },
        { "parameters",             "properties" },
    };

    /// <summary>
    /// Unified smart prefab endpoint. Determines action from provided fields.
    /// </summary>
    internal static async Task HandlePrefab(string requestId, JToken body)
    {
        // Normalize all field names to protect against LLM hallucination
        var b = MessageRouter.NormalizeKeys(body, PrefabCanonicalMap);

        int instanceId = b?["instanceId"]?.ToObject<int>() ?? 0;
        string assetPath = b?["assetPath"]?.ToString();
        string prefabName = b?["prefabName"]?.ToString();

        // Instantiation params
        int? parentInstanceId = b?["parentInstanceId"]?.ToObject<int?>();
        float[] position = b?["position"]?.ToObject<float[]>();
        float[] rotation = b?["rotation"]?.ToObject<float[]>();
        float[] scale = b?["scale"]?.ToObject<float[]>();

        // Creation params
        string savePath = b?["savePath"]?.ToString();

        // Modification params
        string componentType = b?["componentType"]?.ToString();
        string targetPath = b?["targetPath"]?.ToString();

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

        var result = PrefabManager.ManagePrefab(
            instanceId: instanceId,
            assetPath: assetPath,
            prefabName: prefabName,
            parentInstanceId: parentInstanceId,
            position: position,
            rotation: rotation,
            scale: scale,
            savePath: savePath,
            componentType: componentType,
            targetPath: targetPath,
            properties: properties
        );

        await MessageRouter.SendResponse(requestId, "prefab_result", result);
    }

    // --- Legacy Prefab Operation Handlers ---

    internal static async Task HandleListPrefabs(string requestId, JToken body)
    {
        string folder = body?["folder"]?.ToString();
        string searchFilter = body?["searchFilter"]?.ToString();
        int limit = body?["limit"]?.ToObject<int>() ?? 100;

        var result = PrefabManager.ListPrefabs(folder, searchFilter, limit);
        await MessageRouter.SendResponse(requestId, "prefabs_list_response", result);
    }

    internal static async Task HandleInstantiatePrefab(string requestId, JToken body)
    {
        string assetPath = body?["assetPath"]?.ToString();
        int? parentId = body?["parentInstanceId"]?.ToObject<int?>();
        float[] position = body?["position"]?.ToObject<float[]>();
        float[] rotation = body?["rotation"]?.ToObject<float[]>();
        float[] scale = body?["scale"]?.ToObject<float[]>();

        if (string.IsNullOrEmpty(assetPath))
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "assetPath is required" });
            return;
        }

        var result = PrefabManager.InstantiatePrefab(assetPath, parentId, position, rotation, scale);
        await MessageRouter.SendResponse(requestId, "prefab_instantiated", result);
    }

    internal static async Task HandleInstantiatePrefabByName(string requestId, JToken body)
    {
        string prefabName = body?["prefabName"]?.ToString();
        int? parentId = body?["parentInstanceId"]?.ToObject<int?>();
        float[] position = body?["position"]?.ToObject<float[]>();
        float[] rotation = body?["rotation"]?.ToObject<float[]>();
        float[] scale = body?["scale"]?.ToObject<float[]>();

        if (string.IsNullOrEmpty(prefabName))
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "prefabName is required" });
            return;
        }

        var result = PrefabManager.InstantiatePrefabByName(prefabName, parentId, position, rotation, scale);
        await MessageRouter.SendResponse(requestId, "prefab_instantiated", result);
    }

    internal static async Task HandleCreatePrefab(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        string savePath = body?["savePath"]?.ToString();

        var result = PrefabManager.CreatePrefabFromGameObject(instanceId, savePath);
        await MessageRouter.SendResponse(requestId, "prefab_created", result);
    }

    internal static async Task HandleCreatePrefabVariant(string requestId, JToken body)
    {
        string sourcePath = body?["sourcePrefabPath"]?.ToString();
        string variantPath = body?["variantPath"]?.ToString();

        if (string.IsNullOrEmpty(sourcePath))
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "sourcePrefabPath is required" });
            return;
        }

        var result = PrefabManager.CreatePrefabVariant(sourcePath, variantPath);
        await MessageRouter.SendResponse(requestId, "prefab_variant_created", result);
    }

    internal static async Task HandleApplyPrefab(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;

        var result = PrefabManager.ApplyPrefabInstance(instanceId);
        await MessageRouter.SendResponse(requestId, "prefab_applied", result);
    }

    internal static async Task HandleRevertPrefab(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;

        var result = PrefabManager.RevertPrefabInstance(instanceId);
        await MessageRouter.SendResponse(requestId, "prefab_reverted", result);
    }

    internal static async Task HandleUnpackPrefab(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        bool completely = body?["completely"]?.ToObject<bool>() ?? false;

        var result = PrefabManager.UnpackPrefab(instanceId, completely);
        await MessageRouter.SendResponse(requestId, "prefab_unpacked", result);
    }

    internal static async Task HandleOpenPrefab(string requestId, JToken body)
    {
        string assetPath = body?["assetPath"]?.ToString();

        if (string.IsNullOrEmpty(assetPath))
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "assetPath is required" });
            return;
        }

        var result = PrefabManager.OpenPrefabForEditing(assetPath);
        await MessageRouter.SendResponse(requestId, "prefab_opened", result);
    }

    internal static async Task HandleAddComponentToPrefab(string requestId, JToken body)
    {
        string assetPath = body?["assetPath"]?.ToString();
        string componentType = body?["componentType"]?.ToString();

        if (string.IsNullOrEmpty(assetPath))
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "assetPath is required" });
            return;
        }

        if (string.IsNullOrEmpty(componentType))
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "componentType is required" });
            return;
        }

        var result = PrefabManager.AddComponentToPrefab(assetPath, componentType);
        await MessageRouter.SendResponse(requestId, "component_added_to_prefab", result);
    }

    /// <summary>
    /// Handle modifying properties on a prefab asset directly.
    /// </summary>
    internal static async Task HandleModifyPrefab(string requestId, JToken body)
    {
        string assetPath = body?["assetPath"]?.ToString();
        string componentType = body?["componentType"]?.ToString();
        string targetPath = body?["targetPath"]?.ToString();
        JObject propertiesObj = body?["properties"] as JObject;

        if (string.IsNullOrEmpty(assetPath))
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "assetPath is required" });
            return;
        }

        if (string.IsNullOrEmpty(componentType))
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "componentType is required" });
            return;
        }

        if (propertiesObj == null || propertiesObj.Count == 0)
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "properties object is required" });
            return;
        }

        // Convert JObject to Dictionary
        var properties = new Dictionary<string, JToken>();
        foreach (var prop in propertiesObj)
        {
            properties[prop.Key] = prop.Value;
        }

        var result = PrefabManager.ModifyPrefab(assetPath, componentType, properties, targetPath);
        await MessageRouter.SendResponse(requestId, "prefab_modified", result);
    }
}
#endif
