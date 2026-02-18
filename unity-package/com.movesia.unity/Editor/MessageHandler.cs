#if UNITY_EDITOR
using System;
using System.Linq;
using UnityEngine;
using UnityEditor;
using UnityEngine.SceneManagement;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Threading.Tasks;
using System.Collections.Generic;

/// <summary>
/// Routes incoming WebSocket messages to appropriate handlers.
/// </summary>
public static class MessageHandler
{
    // =========================================================================
    // FUZZY KEY NORMALIZATION — protects against LLM field-name hallucination
    // =========================================================================

    /// <summary>
    /// Normalize a JObject's keys so that LLM hallucinations like
    /// "game_object_instance_ID", "gameObjectInstanceID", "shader_name", etc.
    /// all resolve to the canonical camelCase field names.
    ///
    /// Algorithm: strip underscores + lowercase → match against canonical map.
    /// Only renames keys that have a known canonical form; unknown keys pass through unchanged.
    /// Recurses into nested JObjects that are listed in nestedKeys.
    /// </summary>
    private static JObject NormalizeKeys(JToken token, Dictionary<string, string> canonicalMap, HashSet<string> nestedKeys = null)
    {
        if (token == null || token.Type != JTokenType.Object)
            return token as JObject;

        var obj = (JObject)token;
        var normalized = new JObject();

        foreach (var prop in obj.Properties())
        {
            // Normalize: strip underscores, lowercase → lookup canonical name
            string fuzzyKey = prop.Name.Replace("_", "").ToLowerInvariant();
            string canonicalName;

            if (canonicalMap.TryGetValue(fuzzyKey, out canonicalName))
            {
                // Recurse into known nested objects
                if (nestedKeys != null && nestedKeys.Contains(canonicalName) && prop.Value.Type == JTokenType.Object)
                {
                    // Look up the nested canonical map
                    Dictionary<string, string> nestedMap;
                    if (NestedCanonicalMaps.TryGetValue(canonicalName, out nestedMap))
                    {
                        normalized[canonicalName] = NormalizeKeys(prop.Value, nestedMap);
                    }
                    else
                    {
                        normalized[canonicalName] = prop.Value;
                    }
                }
                else
                {
                    normalized[canonicalName] = prop.Value;
                }
            }
            else
            {
                // Unknown key — pass through as-is (could be a material property name like "_BaseColor")
                normalized[prop.Name] = prop.Value;
            }
        }

        return normalized;
    }

    // --- Material endpoint: canonical field names ---
    // Key = lowercased + underscores stripped, Value = canonical camelCase name
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

    // --- assignTo nested object: canonical field names ---
    private static readonly Dictionary<string, string> AssignToCanonicalMap =
        new Dictionary<string, string>
    {
        // gameObjectInstanceId
        { "gameobjectinstanceid",   "gameObjectInstanceId" },
        { "gameobjectid",           "gameObjectInstanceId" },
        { "goinstanceid",           "gameObjectInstanceId" },
        { "gobjectid",              "gameObjectInstanceId" },
        { "targetinstanceid",       "gameObjectInstanceId" },
        { "instanceid",             "gameObjectInstanceId" },
        { "objectid",               "gameObjectInstanceId" },

        // slotIndex
        { "slotindex",              "slotIndex" },
        { "slotidx",                "slotIndex" },
        { "materialslot",           "slotIndex" },
        { "slot",                   "slotIndex" },
        { "index",                  "slotIndex" },
        { "materialindex",          "slotIndex" },
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

    // Which keys in MaterialCanonicalMap contain nested objects that need their own normalization
    private static readonly HashSet<string> MaterialNestedKeys = new HashSet<string> { "assignTo" };

    // Map from nested key name → its canonical map
    private static readonly Dictionary<string, Dictionary<string, string>> NestedCanonicalMaps =
        new Dictionary<string, Dictionary<string, string>>
    {
        { "assignTo", AssignToCanonicalMap }
    };

    /// <summary>
    /// Process an incoming message and send response if needed.
    /// </summary>
    public static async Task HandleMessage(string json)
    {
        try
        {
            var envelope = JObject.Parse(json);
            string type = envelope["type"]?.ToString();
            string requestId = envelope["id"]?.ToString();
            JToken body = envelope["body"];

            bool isHeartbeat = type == "pong" || type == "hb";
            if (!isHeartbeat)
            {
                Debug.Log($"📥 WS RECV: type={type}, id={requestId ?? "(null)"}");
                Debug.Log($"🔍 Extracted requestId: {requestId ?? "(null)"}");
            }

            switch (type)
            {
                case "pong":
                    break;  // Server heartbeat response — silently ignore
                case "get_logs":
                    await HandleGetLogs(requestId, body);
                    break;
                    
                case "get_errors":
                    await HandleGetErrors(requestId, body);
                    break;
                    
                case "clear_logs":
                    await HandleClearLogs(requestId, body);
                    break;
                    
                case "ping":
                    await HandlePing(requestId, body);
                    break;

                case "get_hierarchy":
                    await HandleGetHierarchy(requestId, body);
                    break;

                case "get_scenes":
                    await HandleGetScenes(requestId, body);
                    break;

                case "get_project_settings":
                    await HandleGetProjectSettings(requestId, body);
                    break;

                case "get_components":
                    await HandleGetComponents(requestId, body);
                    break;

                case "create_gameobject":
                    await HandleCreateGameObject(requestId, body);
                    break;

                case "duplicate_gameobject":
                    await HandleDuplicateGameObject(requestId, body);
                    break;

                case "destroy_gameobject":
                    await HandleDestroyGameObject(requestId, body);
                    break;

                case "rename_gameobject":
                    await HandleRenameGameObject(requestId, body);
                    break;

                case "set_parent":
                    await HandleSetParent(requestId, body);
                    break;

                case "set_sibling_index":
                    await HandleSetSiblingIndex(requestId, body);
                    break;

                case "move_to_scene":
                    await HandleMoveToScene(requestId, body);
                    break;

                case "set_active":
                    await HandleSetActive(requestId, body);
                    break;

                case "set_transform":
                    await HandleSetTransform(requestId, body);
                    break;

                case "add_component":
                    await HandleAddComponent(requestId, body);
                    break;

                case "remove_component":
                    await HandleRemoveComponent(requestId, body);
                    break;

                // --- Component Property Modification ---
                case "modify_component":
                    await HandleModifyComponent(requestId, body);
                    break;

                // --- Prefab Operations ---
                case "list_prefabs":
                    await HandleListPrefabs(requestId, body);
                    break;

                case "instantiate_prefab":
                    await HandleInstantiatePrefab(requestId, body);
                    break;

                case "instantiate_prefab_by_name":
                    await HandleInstantiatePrefabByName(requestId, body);
                    break;

                case "create_prefab":
                    await HandleCreatePrefab(requestId, body);
                    break;

                case "create_prefab_variant":
                    await HandleCreatePrefabVariant(requestId, body);
                    break;

                case "apply_prefab":
                    await HandleApplyPrefab(requestId, body);
                    break;

                case "revert_prefab":
                    await HandleRevertPrefab(requestId, body);
                    break;

                case "unpack_prefab":
                    await HandleUnpackPrefab(requestId, body);
                    break;

                case "open_prefab":
                    await HandleOpenPrefab(requestId, body);
                    break;

                case "add_component_to_prefab":
                    await HandleAddComponentToPrefab(requestId, body);
                    break;

                case "modify_prefab":
                    await HandleModifyPrefab(requestId, body);
                    break;

                // --- Scene Operations ---
                case "create_scene":
                    await HandleCreateScene(requestId, body);
                    break;

                case "open_scene":
                    await HandleOpenScene(requestId, body);
                    break;

                case "save_scene":
                    await HandleSaveScene(requestId, body);
                    break;

                case "set_active_scene":
                    await HandleSetActiveScene(requestId, body);
                    break;

                // --- Asset Search ---
                case "search_assets":
                    await HandleSearchAssets(requestId, body);
                    break;

                case "get_asset_labels":
                    await HandleGetAssetLabels(requestId, body);
                    break;

                case "get_type_aliases":
                    await HandleGetTypeAliases(requestId, body);
                    break;

                // --- Asset Deletion ---
                case "delete_assets":
                    await HandleDeleteAssets(requestId, body);
                    break;

                // --- Material Operations ---
                case "material":
                    await HandleMaterial(requestId, body);
                    break;

                case "list_shaders":
                    await HandleListShaders(requestId, body);
                    break;

                // --- Compilation/Refresh Operations ---
                case "refresh_assets":
                    await HandleRefreshAssets(requestId, body);
                    break;

                case "get_compilation_status":
                    await HandleGetCompilationStatus(requestId, body);
                    break;

                case "get_available_types":
                    await HandleGetAvailableTypes(requestId, body);
                    break;

                default:
                    Debug.Log($"🔧 Unhandled message type: {type}");
                    break;
            }
        }
        catch (JsonException ex)
        {
            Debug.LogWarning($"Failed to parse message: {ex.Message}");
        }
    }
    
    // --- Handlers ---
    
    private static async Task HandleGetLogs(string requestId, JToken body)
    {
        int limit = body?["limit"]?.ToObject<int>() ?? 0;
        string filter = body?["filter"]?.ToString();

        ConsoleLogBuffer.LogEntry[] logs;

        // Get logs — filtered or all
        if (!string.IsNullOrEmpty(filter))
        {
            logs = ConsoleLogBuffer.GetLogs(filter);
        }
        else
        {
            logs = ConsoleLogBuffer.GetLogs();
        }

        // Apply limit after filtering — returns the most recent N
        if (limit > 0 && logs.Length > limit)
        {
            var limited = new ConsoleLogBuffer.LogEntry[limit];
            Array.Copy(logs, logs.Length - limit, limited, 0, limit);
            logs = limited;
        }

        await SendResponse(requestId, "logs_response", new
        {
            count = logs.Length,
            logs
        });
    }
    
    private static async Task HandleGetErrors(string requestId, JToken body)
    {
        var errors = ConsoleLogBuffer.GetLogs("Error");
        var exceptions = ConsoleLogBuffer.GetLogs("Exception");
        
        var allErrors = new ConsoleLogBuffer.LogEntry[errors.Length + exceptions.Length];
        errors.CopyTo(allErrors, 0);
        exceptions.CopyTo(allErrors, errors.Length);
        
        await SendResponse(requestId, "errors_response", new 
        { 
            count = allErrors.Length,
            logs = allErrors 
        });
    }
    
    private static async Task HandleClearLogs(string requestId, JToken body)
    {
        ConsoleLogBuffer.Clear();
        await SendResponse(requestId, "clear_response", new { success = true });
    }
    
    private static async Task HandlePing(string requestId, JToken body)
    {
        await SendResponse(requestId, "pong", new
        {
            serverTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
    }

    private static async Task HandleGetHierarchy(string requestId, JToken body)
    {
        int maxDepth = body?["maxDepth"]?.ToObject<int>() ?? 10;

        var snapshot = HierarchyTracker.CaptureSnapshot(maxDepth);

        await SendResponse(requestId, "hierarchy_response", snapshot);
    }

    private static async Task HandleGetScenes(string requestId, JToken body)
    {
        var scenes = HierarchyTracker.CaptureSceneList();

        await SendResponse(requestId, "scenes_response", new
        {
            count = scenes.Length,
            scenes
        });
    }

    private static async Task HandleGetProjectSettings(string requestId, JToken body)
    {
        string category = body?["category"]?.ToString();

        object result;

        if (!string.IsNullOrEmpty(category))
        {
            result = ProjectSettingsTracker.CaptureCategory(category);
            if (result == null)
            {
                await SendResponse(requestId, "error_response", new
                {
                    error = $"Unknown category: {category}",
                    validCategories = new[] { "environment", "player", "build", "quality", "physics", "time", "audio", "rendering", "packages" }
                });
                return;
            }
        }
        else
        {
            result = ProjectSettingsTracker.CaptureSnapshot();
        }

        await SendResponse(requestId, "project_settings_response", result);
    }

    private static async Task HandleGetComponents(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;

        var go = EditorUtility.InstanceIDToObject(instanceId) as GameObject;
        if (go == null)
        {
            await SendResponse(requestId, "error_response", new { error = "GameObject not found", instanceId });
            return;
        }

        var components = ComponentInspector.DumpComponents(go);

        await SendResponse(requestId, "components_response", new
        {
            gameObjectInstanceId = instanceId,
            gameObjectName = go.name,
            count = components.Length,
            components
        });
    }

    // --- GameObject Manipulation Handlers ---

    private static async Task HandleCreateGameObject(string requestId, JToken body)
    {
        string name = body?["name"]?.ToString();
        string primitive = body?["primitive"]?.ToString();
        int? parentId = body?["parentInstanceId"]?.ToObject<int?>();
        float[] position = body?["position"]?.ToObject<float[]>();
        float[] rotation = body?["rotation"]?.ToObject<float[]>();
        float[] scale = body?["scale"]?.ToObject<float[]>();
        string[] components = body?["components"]?.ToObject<string[]>();

        var result = HierarchyManipulator.Create(name, primitive, parentId, position, rotation, scale, components);
        await SendResponse(requestId, "gameobject_created", result);
    }

    private static async Task HandleDuplicateGameObject(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;

        var result = HierarchyManipulator.Duplicate(instanceId);
        await SendResponse(requestId, "gameobject_duplicated", result);
    }

    private static async Task HandleDestroyGameObject(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;

        var result = HierarchyManipulator.Destroy(instanceId);
        await SendResponse(requestId, "gameobject_destroyed", result);
    }

    private static async Task HandleRenameGameObject(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        string newName = body?["name"]?.ToString() ?? "Unnamed";

        var result = HierarchyManipulator.Rename(instanceId, newName);
        await SendResponse(requestId, "gameobject_renamed", result);
    }

    private static async Task HandleSetParent(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        int? parentId = body?["parentInstanceId"]?.ToObject<int?>();
        bool worldPositionStays = body?["worldPositionStays"]?.ToObject<bool>() ?? true;

        var result = HierarchyManipulator.SetParent(instanceId, parentId, worldPositionStays);
        await SendResponse(requestId, "parent_set", result);
    }

    private static async Task HandleSetSiblingIndex(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        int siblingIndex = body?["siblingIndex"]?.ToObject<int>() ?? 0;

        var result = HierarchyManipulator.SetSiblingIndex(instanceId, siblingIndex);
        await SendResponse(requestId, "sibling_index_set", result);
    }

    private static async Task HandleMoveToScene(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        string sceneName = body?["sceneName"]?.ToString();

        if (string.IsNullOrEmpty(sceneName))
        {
            await SendResponse(requestId, "error_response", new { error = "sceneName is required" });
            return;
        }

        var result = HierarchyManipulator.MoveToScene(instanceId, sceneName);
        await SendResponse(requestId, "moved_to_scene", result);
    }

    private static async Task HandleSetActive(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        bool active = body?["active"]?.ToObject<bool>() ?? true;

        var result = HierarchyManipulator.SetActive(instanceId, active);
        await SendResponse(requestId, "active_set", result);
    }

    private static async Task HandleSetTransform(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        float[] position = body?["position"]?.ToObject<float[]>();
        float[] rotation = body?["rotation"]?.ToObject<float[]>();
        float[] scale = body?["scale"]?.ToObject<float[]>();
        bool local = body?["local"]?.ToObject<bool>() ?? true;

        var result = HierarchyManipulator.SetTransform(instanceId, position, rotation, scale, local);
        await SendResponse(requestId, "transform_set", result);
    }

    private static async Task HandleAddComponent(string requestId, JToken body)
    {
        // Debug: Log the raw body to see what we received
        Debug.Log($"[HandleAddComponent] Raw body: {body}");
        Debug.Log($"[HandleAddComponent] body is null: {body == null}");
        Debug.Log($"[HandleAddComponent] body type: {body?.GetType().Name}");

        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        string componentType = body?["componentType"]?.ToString();

        Debug.Log($"[HandleAddComponent] instanceId: {instanceId}");
        Debug.Log($"[HandleAddComponent] componentType raw: {body?["componentType"]}");
        Debug.Log($"[HandleAddComponent] componentType parsed: '{componentType}'");

        if (string.IsNullOrEmpty(componentType))
        {
            Debug.LogWarning($"[HandleAddComponent] componentType is null or empty! Body keys: {string.Join(", ", (body as JObject)?.Properties().Select(p => p.Name) ?? Array.Empty<string>())}");
            await SendResponse(requestId, "error_response", new { error = "componentType is required" });
            return;
        }

        var result = HierarchyManipulator.AddComponent(instanceId, componentType);
        await SendResponse(requestId, "component_added", result);
    }

    private static async Task HandleRemoveComponent(string requestId, JToken body)
    {
        int componentInstanceId = body?["componentInstanceId"]?.ToObject<int>() ?? 0;

        var result = HierarchyManipulator.RemoveComponent(componentInstanceId);
        await SendResponse(requestId, "component_removed", result);
    }

    // --- Component Property Modification Handlers ---

    /// <summary>
    /// Handle modifying component properties in a batch.
    /// Message format (Option 1 - direct component ID):
    /// {
    ///   "type": "modify_component",
    ///   "body": {
    ///     "componentInstanceId": -20366,
    ///     "properties": {
    ///       "m_Radius": 1.5,
    ///       "m_Height": 3.0,
    ///       "m_Center": [0, 1, 0]
    ///     }
    ///   }
    /// }
    ///
    /// Message format (Option 2 - resolve from GameObject + type):
    /// {
    ///   "type": "modify_component",
    ///   "body": {
    ///     "gameObjectInstanceId": -12345,
    ///     "componentType": "BoxCollider",
    ///     "componentIndex": 0,  // optional, for multiple components of same type
    ///     "properties": {
    ///       "m_Size": [2, 3, 1],
    ///       "m_Center": [0, 1.5, 0]
    ///     }
    ///   }
    /// }
    /// </summary>
    private static async Task HandleModifyComponent(string requestId, JToken body)
    {
        int componentInstanceId = body?["componentInstanceId"]?.ToObject<int>() ?? 0;
        int gameObjectInstanceId = body?["gameObjectInstanceId"]?.ToObject<int>() ?? 0;
        string componentType = body?["componentType"]?.ToString();
        int componentIndex = body?["componentIndex"]?.ToObject<int>() ?? 0;
        JObject propertiesObj = body?["properties"] as JObject;

        if (propertiesObj == null || propertiesObj.Count == 0)
        {
            await SendResponse(requestId, "error_response", new { error = "properties object is required" });
            return;
        }

        // Convert JObject to Dictionary
        var properties = new Dictionary<string, JToken>();
        foreach (var prop in propertiesObj)
        {
            properties[prop.Key] = prop.Value;
        }

        var result = HierarchyManipulator.ModifyComponent(
            componentInstanceId,
            properties,
            gameObjectInstanceId,
            componentType,
            componentIndex
        );
        await SendResponse(requestId, "component_modified", result);
    }

    // --- Prefab Operation Handlers ---

    private static async Task HandleListPrefabs(string requestId, JToken body)
    {
        string folder = body?["folder"]?.ToString();
        string searchFilter = body?["searchFilter"]?.ToString();
        int limit = body?["limit"]?.ToObject<int>() ?? 100;

        var result = PrefabManager.ListPrefabs(folder, searchFilter, limit);
        await SendResponse(requestId, "prefabs_list_response", result);
    }

    private static async Task HandleInstantiatePrefab(string requestId, JToken body)
    {
        string assetPath = body?["assetPath"]?.ToString();
        int? parentId = body?["parentInstanceId"]?.ToObject<int?>();
        float[] position = body?["position"]?.ToObject<float[]>();
        float[] rotation = body?["rotation"]?.ToObject<float[]>();
        float[] scale = body?["scale"]?.ToObject<float[]>();

        if (string.IsNullOrEmpty(assetPath))
        {
            await SendResponse(requestId, "error_response", new { error = "assetPath is required" });
            return;
        }

        var result = PrefabManager.InstantiatePrefab(assetPath, parentId, position, rotation, scale);
        await SendResponse(requestId, "prefab_instantiated", result);
    }

    private static async Task HandleInstantiatePrefabByName(string requestId, JToken body)
    {
        string prefabName = body?["prefabName"]?.ToString();
        int? parentId = body?["parentInstanceId"]?.ToObject<int?>();
        float[] position = body?["position"]?.ToObject<float[]>();
        float[] rotation = body?["rotation"]?.ToObject<float[]>();
        float[] scale = body?["scale"]?.ToObject<float[]>();

        if (string.IsNullOrEmpty(prefabName))
        {
            await SendResponse(requestId, "error_response", new { error = "prefabName is required" });
            return;
        }

        var result = PrefabManager.InstantiatePrefabByName(prefabName, parentId, position, rotation, scale);
        await SendResponse(requestId, "prefab_instantiated", result);
    }

    private static async Task HandleCreatePrefab(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        string savePath = body?["savePath"]?.ToString();

        var result = PrefabManager.CreatePrefabFromGameObject(instanceId, savePath);
        await SendResponse(requestId, "prefab_created", result);
    }

    private static async Task HandleCreatePrefabVariant(string requestId, JToken body)
    {
        string sourcePath = body?["sourcePrefabPath"]?.ToString();
        string variantPath = body?["variantPath"]?.ToString();

        if (string.IsNullOrEmpty(sourcePath))
        {
            await SendResponse(requestId, "error_response", new { error = "sourcePrefabPath is required" });
            return;
        }

        var result = PrefabManager.CreatePrefabVariant(sourcePath, variantPath);
        await SendResponse(requestId, "prefab_variant_created", result);
    }

    private static async Task HandleApplyPrefab(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;

        var result = PrefabManager.ApplyPrefabInstance(instanceId);
        await SendResponse(requestId, "prefab_applied", result);
    }

    private static async Task HandleRevertPrefab(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;

        var result = PrefabManager.RevertPrefabInstance(instanceId);
        await SendResponse(requestId, "prefab_reverted", result);
    }

    private static async Task HandleUnpackPrefab(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        bool completely = body?["completely"]?.ToObject<bool>() ?? false;

        var result = PrefabManager.UnpackPrefab(instanceId, completely);
        await SendResponse(requestId, "prefab_unpacked", result);
    }

    private static async Task HandleOpenPrefab(string requestId, JToken body)
    {
        string assetPath = body?["assetPath"]?.ToString();

        if (string.IsNullOrEmpty(assetPath))
        {
            await SendResponse(requestId, "error_response", new { error = "assetPath is required" });
            return;
        }

        var result = PrefabManager.OpenPrefabForEditing(assetPath);
        await SendResponse(requestId, "prefab_opened", result);
    }

    private static async Task HandleAddComponentToPrefab(string requestId, JToken body)
    {
        string assetPath = body?["assetPath"]?.ToString();
        string componentType = body?["componentType"]?.ToString();

        if (string.IsNullOrEmpty(assetPath))
        {
            await SendResponse(requestId, "error_response", new { error = "assetPath is required" });
            return;
        }

        if (string.IsNullOrEmpty(componentType))
        {
            await SendResponse(requestId, "error_response", new { error = "componentType is required" });
            return;
        }

        var result = PrefabManager.AddComponentToPrefab(assetPath, componentType);
        await SendResponse(requestId, "component_added_to_prefab", result);
    }

    /// <summary>
    /// Handle modifying properties on a prefab asset directly.
    /// Message format:
    /// {
    ///   "type": "modify_prefab",
    ///   "body": {
    ///     "assetPath": "Assets/Prefabs/Player.prefab",
    ///     "componentType": "BoxCollider",
    ///     "targetPath": "Child/Grandchild",  // optional - path to nested object
    ///     "properties": {
    ///       "m_Size": [2, 3, 1],
    ///       "m_Center": [0, 1.5, 0]
    ///     }
    ///   }
    /// }
    /// </summary>
    private static async Task HandleModifyPrefab(string requestId, JToken body)
    {
        string assetPath = body?["assetPath"]?.ToString();
        string componentType = body?["componentType"]?.ToString();
        string targetPath = body?["targetPath"]?.ToString();
        JObject propertiesObj = body?["properties"] as JObject;

        if (string.IsNullOrEmpty(assetPath))
        {
            await SendResponse(requestId, "error_response", new { error = "assetPath is required" });
            return;
        }

        if (string.IsNullOrEmpty(componentType))
        {
            await SendResponse(requestId, "error_response", new { error = "componentType is required" });
            return;
        }

        if (propertiesObj == null || propertiesObj.Count == 0)
        {
            await SendResponse(requestId, "error_response", new { error = "properties object is required" });
            return;
        }

        // Convert JObject to Dictionary
        var properties = new Dictionary<string, JToken>();
        foreach (var prop in propertiesObj)
        {
            properties[prop.Key] = prop.Value;
        }

        var result = PrefabManager.ModifyPrefab(assetPath, componentType, properties, targetPath);
        await SendResponse(requestId, "prefab_modified", result);
    }

    // --- Scene Operation Handlers ---

    private static async Task HandleCreateScene(string requestId, JToken body)
    {
        string savePath = body?["savePath"]?.ToString();
        bool additive = body?["additive"]?.ToObject<bool>() ?? false;
        string setupMode = body?["setupMode"]?.ToString() ?? "empty";

        var result = SceneManagement.CreateScene(savePath, additive, setupMode);
        await SendResponse(requestId, "scene_created", result);
    }

    private static async Task HandleOpenScene(string requestId, JToken body)
    {
        string scenePath = body?["scenePath"]?.ToString();
        bool additive = body?["additive"]?.ToObject<bool>() ?? false;

        if (string.IsNullOrEmpty(scenePath))
        {
            await SendResponse(requestId, "error_response", new { error = "scenePath is required" });
            return;
        }

        var result = SceneManagement.OpenScene(scenePath, additive);
        await SendResponse(requestId, "scene_opened", result);
    }

    private static async Task HandleSaveScene(string requestId, JToken body)
    {
        string sceneName = body?["sceneName"]?.ToString();
        string savePath = body?["savePath"]?.ToString();

        var result = SceneManagement.SaveScene(sceneName, savePath);
        await SendResponse(requestId, "scene_saved", result);
    }

    private static async Task HandleSetActiveScene(string requestId, JToken body)
    {
        string sceneName = body?["sceneName"]?.ToString();

        if (string.IsNullOrEmpty(sceneName))
        {
            await SendResponse(requestId, "error_response", new { error = "sceneName is required" });
            return;
        }

        var result = SceneManagement.SetActiveScene(sceneName);
        await SendResponse(requestId, "active_scene_set", result);
    }

    // --- Asset Search Handlers ---

    private static async Task HandleSearchAssets(string requestId, JToken body)
    {
        string type = body?["type"]?.ToString();
        string nameFilter = body?["name"]?.ToString();
        string label = body?["label"]?.ToString();
        string folder = body?["folder"]?.ToString();
        int limit = body?["limit"]?.ToObject<int>() ?? 100;
        string extension = body?["extension"]?.ToString();

        var result = AssetSearch.Search(type, nameFilter, label, folder, limit, extension);
        await SendResponse(requestId, "assets_found", result);
    }

    private static async Task HandleGetAssetLabels(string requestId, JToken body)
    {
        var labels = AssetSearch.GetAllLabels();
        await SendResponse(requestId, "asset_labels", new { count = labels.Length, labels });
    }

    private static async Task HandleGetTypeAliases(string requestId, JToken body)
    {
        var aliases = AssetSearch.GetTypeAliases();
        await SendResponse(requestId, "type_aliases", aliases);
    }

    // --- Asset Deletion Handlers ---

    private static async Task HandleDeleteAssets(string requestId, JToken body)
    {
        var result = await DeletionManager.HandleDeleteRequest(requestId, body);

        // If result is null, domain reload is happening and response will be sent after reload
        if (result != null)
        {
            await SendResponse(requestId, "assets_deleted", result);
        }
    }

    // --- Material Operation Handlers ---

    /// <summary>
    /// Unified smart material endpoint. Determines action from what's provided:
    ///   - No instanceId/assetPath → create new material (uses shaderName, name, savePath)
    ///   - instanceId or assetPath → load existing material
    ///   - properties/keywords present → modify the material
    ///   - assignTo present → assign to a GameObject's Renderer
    /// All steps in one call; each step is optional.
    ///
    /// Body: {
    ///   instanceId?, assetPath?,                              // identify existing (omit to create)
    ///   shaderName?, name?, savePath?,                        // creation params
    ///   properties?: { color: [r,g,b,a], metallic: 0.5 },    // modification
    ///   keywords?: { "_EMISSION": true },                     // keyword toggles
    ///   assignTo?: { gameObjectInstanceId, slotIndex? }       // assignment
    /// }
    /// </summary>
    private static async Task HandleMaterial(string requestId, JToken body)
    {
        // Normalize all field names to protect against LLM hallucination
        // e.g. "shader_name" → "shaderName", "gameObjectInstanceID" → "gameObjectInstanceId"
        var b = NormalizeKeys(body, MaterialCanonicalMap, MaterialNestedKeys);

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

        await SendResponse(requestId, "material_result", result);
    }

    /// <summary>
    /// List available shaders with their properties.
    /// Body: { filter?, includeProperties?: true, limit?: 50 }
    /// </summary>
    private static async Task HandleListShaders(string requestId, JToken body)
    {
        // Normalize field names to protect against LLM hallucination
        var b = NormalizeKeys(body, ListShadersCanonicalMap);

        string filter = b?["filter"]?.ToString();
        bool includeProperties = b?["includeProperties"]?.ToObject<bool>() ?? true;
        int limit = b?["limit"]?.ToObject<int>() ?? 50;

        var result = MaterialManager.ListShaders(filter, includeProperties, limit);
        await SendResponse(requestId, "shaders_list", result);
    }

    // --- Compilation Handlers ---

    /// <summary>
    /// Triggers asset refresh and script compilation.
    /// This may cause a domain reload - the response will be sent asynchronously
    /// after compilation completes via "compilation_complete" message.
    ///
    /// Request body:
    /// {
    ///   "watchedScripts": ["PlayerHealth", "EnemyAI"],  // Optional: verify these types exist after compile
    ///   "forceRecompile": false  // Optional: force refresh even if no changes detected
    /// }
    /// </summary>
    private static async Task HandleRefreshAssets(string requestId, JToken body)
    {
        var result = await CompilationManager.HandleRefreshRequest(requestId, body);

        // If result is null, domain reload is happening and response will be sent later
        if (result != null)
        {
            await SendResponse(requestId, "refresh_assets_response", result);
        }
        // If result is null, CompilationManager will send "compilation_complete" after domain reload
    }

    /// <summary>
    /// Gets current compilation status without triggering a refresh.
    ///
    /// Response:
    /// {
    ///   "isCompiling": false,
    ///   "hasErrors": false,
    ///   "errors": [],
    ///   "availableTypes": ["PlayerController", "EnemyAI", ...]
    /// }
    /// </summary>
    private static async Task HandleGetCompilationStatus(string requestId, JToken body)
    {
        var status = CompilationManager.GetCompilationStatus();
        await SendResponse(requestId, "compilation_status", status);
    }

    /// <summary>
    /// Gets all available component types (MonoBehaviours and built-in Unity components).
    /// Useful for the agent to know what components can be attached.
    ///
    /// Request body:
    /// {
    ///   "filter": "Player",  // Optional: filter by name
    ///   "includeBuiltIn": true  // Optional: include Unity built-in components
    /// }
    /// </summary>
    private static async Task HandleGetAvailableTypes(string requestId, JToken body)
    {
        string filter = body?["filter"]?.ToString();
        bool includeBuiltIn = body?["includeBuiltIn"]?.ToObject<bool>() ?? true;

        var types = new List<object>();

        // Get custom MonoBehaviours from Assembly-CSharp
        var customTypes = TypeCache.GetTypesDerivedFrom<MonoBehaviour>()
            .Where(t => !t.IsAbstract && !t.IsGenericType)
            .Where(t => t.Assembly.GetName().Name == "Assembly-CSharp" ||
                       t.Assembly.GetName().Name == "Assembly-CSharp-Editor")
            .Where(t => string.IsNullOrEmpty(filter) ||
                       t.Name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0)
            .Select(t => new {
                name = t.Name,
                fullName = t.FullName,
                isCustom = true,
                assembly = t.Assembly.GetName().Name
            });

        types.AddRange(customTypes);

        // Optionally include common built-in Unity components
        if (includeBuiltIn)
        {
            var builtInTypes = new[]
            {
                "Rigidbody", "Rigidbody2D",
                "BoxCollider", "SphereCollider", "CapsuleCollider", "MeshCollider",
                "BoxCollider2D", "CircleCollider2D", "PolygonCollider2D",
                "AudioSource", "AudioListener",
                "Camera", "Light",
                "MeshRenderer", "MeshFilter", "SkinnedMeshRenderer",
                "SpriteRenderer", "LineRenderer", "TrailRenderer",
                "Canvas", "CanvasRenderer", "CanvasScaler", "GraphicRaycaster",
                "Animator", "Animation",
                "NavMeshAgent", "NavMeshObstacle",
                "CharacterController",
                "ParticleSystem",
                "TextMesh"
            }
            .Where(t => string.IsNullOrEmpty(filter) ||
                       t.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0)
            .Select(t => new {
                name = t,
                fullName = "UnityEngine." + t,
                isCustom = false,
                assembly = "UnityEngine"
            });

            types.AddRange(builtInTypes);
        }

        await SendResponse(requestId, "available_types", new {
            count = types.Count,
            types = types.OrderBy(t => ((dynamic)t).name).ToList()
        });
    }

    // --- Response Helper ---

    private static async Task SendResponse(string requestId, string type, object body)
    {
        if (type != "pong") Debug.Log($"📤 SendResponse: requestId={requestId ?? "(null)"}, type={type}");
        await WebSocketClient.Send(type, body, requestId);
    }
}
#endif