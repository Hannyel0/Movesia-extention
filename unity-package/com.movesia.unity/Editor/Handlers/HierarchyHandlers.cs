#if UNITY_EDITOR
using System.Threading.Tasks;
using UnityEngine;
using UnityEditor;
using Newtonsoft.Json.Linq;

/// <summary>
/// Handles hierarchy read/write messages: get_hierarchy, get_scenes, get_project_settings,
/// get_components, and all GameObject manipulation (create, duplicate, destroy, rename,
/// set_parent, set_sibling_index, move_to_scene, set_active, set_transform).
/// </summary>
internal static class HierarchyHandlers
{
    // --- Read Operations ---

    internal static async Task HandleGetHierarchy(string requestId, JToken body)
    {
        int maxDepth = body?["maxDepth"]?.ToObject<int>() ?? 10;

        var snapshot = HierarchyTracker.CaptureSnapshot(maxDepth);

        await MessageRouter.SendResponse(requestId, "hierarchy_response", snapshot);
    }

    internal static async Task HandleGetScenes(string requestId, JToken body)
    {
        var scenes = HierarchyTracker.CaptureSceneList();

        await MessageRouter.SendResponse(requestId, "scenes_response", new
        {
            count = scenes.Length,
            scenes
        });
    }

    internal static async Task HandleGetProjectSettings(string requestId, JToken body)
    {
        string category = body?["category"]?.ToString();

        object result;

        if (!string.IsNullOrEmpty(category))
        {
            result = ProjectSettingsTracker.CaptureCategory(category);
            if (result == null)
            {
                await MessageRouter.SendResponse(requestId, "error_response", new
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

        await MessageRouter.SendResponse(requestId, "project_settings_response", result);
    }

    internal static async Task HandleGetComponents(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;

        var go = EditorUtility.EntityIdToObject(instanceId) as GameObject;
        if (go == null)
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "GameObject not found", instanceId });
            return;
        }

        var components = ComponentInspector.DumpComponents(go);

        await MessageRouter.SendResponse(requestId, "components_response", new
        {
            gameObjectInstanceId = instanceId,
            gameObjectName = go.name,
            count = components.Length,
            components
        });
    }

    // --- GameObject Manipulation ---

    internal static async Task HandleCreateGameObject(string requestId, JToken body)
    {
        string name = body?["name"]?.ToString();
        string primitive = body?["primitive"]?.ToString();
        int? parentId = body?["parentInstanceId"]?.ToObject<int?>();
        float[] position = body?["position"]?.ToObject<float[]>();
        float[] rotation = body?["rotation"]?.ToObject<float[]>();
        float[] scale = body?["scale"]?.ToObject<float[]>();
        string[] components = body?["components"]?.ToObject<string[]>();

        var result = HierarchyManipulator.Create(name, primitive, parentId, position, rotation, scale, components);
        await MessageRouter.SendResponse(requestId, "gameobject_created", result);
    }

    internal static async Task HandleDuplicateGameObject(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;

        var result = HierarchyManipulator.Duplicate(instanceId);
        await MessageRouter.SendResponse(requestId, "gameobject_duplicated", result);
    }

    internal static async Task HandleDestroyGameObject(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;

        var result = HierarchyManipulator.Destroy(instanceId);
        await MessageRouter.SendResponse(requestId, "gameobject_destroyed", result);
    }

    internal static async Task HandleRenameGameObject(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        string newName = body?["name"]?.ToString() ?? "Unnamed";

        var result = HierarchyManipulator.Rename(instanceId, newName);
        await MessageRouter.SendResponse(requestId, "gameobject_renamed", result);
    }

    internal static async Task HandleSetParent(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        int? parentId = body?["parentInstanceId"]?.ToObject<int?>();
        bool worldPositionStays = body?["worldPositionStays"]?.ToObject<bool>() ?? true;

        var result = HierarchyManipulator.SetParent(instanceId, parentId, worldPositionStays);
        await MessageRouter.SendResponse(requestId, "parent_set", result);
    }

    internal static async Task HandleSetSiblingIndex(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        int siblingIndex = body?["siblingIndex"]?.ToObject<int>() ?? 0;

        var result = HierarchyManipulator.SetSiblingIndex(instanceId, siblingIndex);
        await MessageRouter.SendResponse(requestId, "sibling_index_set", result);
    }

    internal static async Task HandleMoveToScene(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        string sceneName = body?["sceneName"]?.ToString();

        if (string.IsNullOrEmpty(sceneName))
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "sceneName is required" });
            return;
        }

        var result = HierarchyManipulator.MoveToScene(instanceId, sceneName);
        await MessageRouter.SendResponse(requestId, "moved_to_scene", result);
    }

    internal static async Task HandleSetActive(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        bool active = body?["active"]?.ToObject<bool>() ?? true;

        var result = HierarchyManipulator.SetActive(instanceId, active);
        await MessageRouter.SendResponse(requestId, "active_set", result);
    }

    internal static async Task HandleSetTransform(string requestId, JToken body)
    {
        int instanceId = body?["instanceId"]?.ToObject<int>() ?? 0;
        float[] position = body?["position"]?.ToObject<float[]>();
        float[] rotation = body?["rotation"]?.ToObject<float[]>();
        float[] scale = body?["scale"]?.ToObject<float[]>();
        bool local = body?["local"]?.ToObject<bool>() ?? true;

        var result = HierarchyManipulator.SetTransform(instanceId, position, rotation, scale, local);
        await MessageRouter.SendResponse(requestId, "transform_set", result);
    }
}
#endif
