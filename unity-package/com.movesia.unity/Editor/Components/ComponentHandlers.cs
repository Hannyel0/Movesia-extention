#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using Newtonsoft.Json.Linq;

/// <summary>
/// Handles component operations: add_component, remove_component, modify_component.
/// </summary>
internal static class ComponentHandlers
{
    internal static async Task HandleAddComponent(string requestId, JToken body)
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
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "componentType is required" });
            return;
        }

        var result = HierarchyManipulator.AddComponent(instanceId, componentType);
        await MessageRouter.SendResponse(requestId, "component_added", result);
    }

    internal static async Task HandleRemoveComponent(string requestId, JToken body)
    {
        int componentInstanceId = body?["componentInstanceId"]?.ToObject<int>() ?? 0;

        var result = HierarchyManipulator.RemoveComponent(componentInstanceId);
        await MessageRouter.SendResponse(requestId, "component_removed", result);
    }

    /// <summary>
    /// Handle modifying component properties in a batch.
    /// Supports both direct component ID and resolve from GameObject + type.
    /// </summary>
    internal static async Task HandleModifyComponent(string requestId, JToken body)
    {
        int componentInstanceId = body?["componentInstanceId"]?.ToObject<int>() ?? 0;
        int gameObjectInstanceId = body?["gameObjectInstanceId"]?.ToObject<int>() ?? 0;
        string componentType = body?["componentType"]?.ToString();
        int componentIndex = body?["componentIndex"]?.ToObject<int>() ?? 0;
        JObject propertiesObj = body?["properties"] as JObject;

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

        var result = HierarchyManipulator.ModifyComponent(
            componentInstanceId,
            properties,
            gameObjectInstanceId,
            componentType,
            componentIndex
        );
        await MessageRouter.SendResponse(requestId, "component_modified", result);
    }
}
#endif
