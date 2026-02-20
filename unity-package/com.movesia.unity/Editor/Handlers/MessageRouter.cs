#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

/// <summary>
/// Routes incoming WebSocket messages to appropriate handler classes.
/// </summary>
public static class MessageRouter
{
    // =========================================================================
    // DYNAMIC HANDLER REGISTRATION — allows optional assemblies (e.g. ProBuilder)
    // to register message handlers without the main assembly referencing them.
    // =========================================================================

    /// <summary>
    /// Handler delegate for dynamically registered message types.
    /// </summary>
    public delegate Task MessageHandlerDelegate(string requestId, JToken body);

    private static readonly Dictionary<string, MessageHandlerDelegate> _dynamicHandlers =
        new Dictionary<string, MessageHandlerDelegate>();

    /// <summary>
    /// Register a handler for a message type. Called by optional assemblies
    /// via [InitializeOnLoad] static constructors.
    /// </summary>
    public static void RegisterHandler(string messageType, MessageHandlerDelegate handler)
    {
        _dynamicHandlers[messageType] = handler;
        Debug.Log($"📦 Registered dynamic handler for message type: {messageType}");
    }

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
    public static JObject NormalizeKeys(JToken token, Dictionary<string, string> canonicalMap, HashSet<string> nestedKeys = null)
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

    // Which keys in MaterialCanonicalMap contain nested objects that need their own normalization
    public static readonly HashSet<string> MaterialNestedKeys = new HashSet<string> { "assignTo" };

    // Map from nested key name → its canonical map
    public static readonly Dictionary<string, Dictionary<string, string>> NestedCanonicalMaps =
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
                // --- Heartbeat ---
                case "pong":
                    break;

                // --- Ping ---
                case "ping":
                    await LogHandlers.HandlePing(requestId, body);
                    break;

                // --- Log Operations ---
                case "get_logs":
                    await LogHandlers.HandleGetLogs(requestId, body);
                    break;
                case "get_errors":
                    await LogHandlers.HandleGetErrors(requestId, body);
                    break;
                case "clear_logs":
                    await LogHandlers.HandleClearLogs(requestId, body);
                    break;

                // --- Hierarchy Read Operations ---
                case "get_hierarchy":
                    await HierarchyHandlers.HandleGetHierarchy(requestId, body);
                    break;
                case "get_scenes":
                    await HierarchyHandlers.HandleGetScenes(requestId, body);
                    break;
                case "get_project_settings":
                    await HierarchyHandlers.HandleGetProjectSettings(requestId, body);
                    break;
                case "get_components":
                    await HierarchyHandlers.HandleGetComponents(requestId, body);
                    break;

                // --- GameObject Manipulation ---
                case "create_gameobject":
                    await HierarchyHandlers.HandleCreateGameObject(requestId, body);
                    break;
                case "duplicate_gameobject":
                    await HierarchyHandlers.HandleDuplicateGameObject(requestId, body);
                    break;
                case "destroy_gameobject":
                    await HierarchyHandlers.HandleDestroyGameObject(requestId, body);
                    break;
                case "rename_gameobject":
                    await HierarchyHandlers.HandleRenameGameObject(requestId, body);
                    break;
                case "set_parent":
                    await HierarchyHandlers.HandleSetParent(requestId, body);
                    break;
                case "set_sibling_index":
                    await HierarchyHandlers.HandleSetSiblingIndex(requestId, body);
                    break;
                case "move_to_scene":
                    await HierarchyHandlers.HandleMoveToScene(requestId, body);
                    break;
                case "set_active":
                    await HierarchyHandlers.HandleSetActive(requestId, body);
                    break;
                case "set_transform":
                    await HierarchyHandlers.HandleSetTransform(requestId, body);
                    break;

                // --- Component Operations ---
                case "add_component":
                    await ComponentHandlers.HandleAddComponent(requestId, body);
                    break;
                case "remove_component":
                    await ComponentHandlers.HandleRemoveComponent(requestId, body);
                    break;
                case "modify_component":
                    await ComponentHandlers.HandleModifyComponent(requestId, body);
                    break;

                // --- Unified Prefab Endpoint ---
                case "prefab":
                    await PrefabHandlers.HandlePrefab(requestId, body);
                    break;

                // --- Legacy Prefab Operations ---
                case "list_prefabs":
                    await PrefabHandlers.HandleListPrefabs(requestId, body);
                    break;
                case "instantiate_prefab":
                    await PrefabHandlers.HandleInstantiatePrefab(requestId, body);
                    break;
                case "instantiate_prefab_by_name":
                    await PrefabHandlers.HandleInstantiatePrefabByName(requestId, body);
                    break;
                case "create_prefab":
                    await PrefabHandlers.HandleCreatePrefab(requestId, body);
                    break;
                case "create_prefab_variant":
                    await PrefabHandlers.HandleCreatePrefabVariant(requestId, body);
                    break;
                case "apply_prefab":
                    await PrefabHandlers.HandleApplyPrefab(requestId, body);
                    break;
                case "revert_prefab":
                    await PrefabHandlers.HandleRevertPrefab(requestId, body);
                    break;
                case "unpack_prefab":
                    await PrefabHandlers.HandleUnpackPrefab(requestId, body);
                    break;
                case "open_prefab":
                    await PrefabHandlers.HandleOpenPrefab(requestId, body);
                    break;
                case "add_component_to_prefab":
                    await PrefabHandlers.HandleAddComponentToPrefab(requestId, body);
                    break;
                case "modify_prefab":
                    await PrefabHandlers.HandleModifyPrefab(requestId, body);
                    break;

                // --- Scene Operations ---
                case "create_scene":
                    await SceneHandlers.HandleCreateScene(requestId, body);
                    break;
                case "open_scene":
                    await SceneHandlers.HandleOpenScene(requestId, body);
                    break;
                case "save_scene":
                    await SceneHandlers.HandleSaveScene(requestId, body);
                    break;
                case "set_active_scene":
                    await SceneHandlers.HandleSetActiveScene(requestId, body);
                    break;

                // --- Asset Search ---
                case "search_assets":
                    await AssetHandlers.HandleSearchAssets(requestId, body);
                    break;
                case "get_asset_labels":
                    await AssetHandlers.HandleGetAssetLabels(requestId, body);
                    break;
                case "get_type_aliases":
                    await AssetHandlers.HandleGetTypeAliases(requestId, body);
                    break;

                // --- Asset Deletion ---
                case "delete_assets":
                    await AssetHandlers.HandleDeleteAssets(requestId, body);
                    break;

                // --- Material Operations ---
                case "material":
                    await MaterialHandlers.HandleMaterial(requestId, body);
                    break;
                case "list_shaders":
                    await MaterialHandlers.HandleListShaders(requestId, body);
                    break;

                // --- Compilation/Refresh ---
                case "refresh_assets":
                    await CompilationHandlers.HandleRefreshAssets(requestId, body);
                    break;
                case "get_compilation_status":
                    await CompilationHandlers.HandleGetCompilationStatus(requestId, body);
                    break;
                case "get_available_types":
                    await CompilationHandlers.HandleGetAvailableTypes(requestId, body);
                    break;

                // --- Screenshot ---
                case "capture_screenshot":
                    await ScreenshotHandlers.HandleCaptureScreenshot(requestId, body);
                    break;

                // --- Spatial Context ---
                case "get_spatial_context":
                    await SpatialHandlers.HandleGetSpatialContext(requestId, body);
                    break;

                default:
                    // Check dynamically registered handlers (from optional assemblies like ProBuilder)
                    if (_dynamicHandlers.TryGetValue(type, out var handler))
                    {
                        await handler(requestId, body);
                    }
                    else
                    {
                        Debug.Log($"🔧 Unhandled message type: {type}");
                    }
                    break;
            }
        }
        catch (JsonException ex)
        {
            Debug.LogWarning($"Failed to parse message: {ex.Message}");
        }
    }

    // --- Response Helper ---

    public static async Task SendResponse(string requestId, string type, object body)
    {
        if (type != "pong") Debug.Log($"📤 SendResponse: requestId={requestId ?? "(null)"}, type={type}");
        await WebSocketClient.Send(type, body, requestId);
    }
}
#endif
