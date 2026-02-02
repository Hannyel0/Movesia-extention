#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System;
using Newtonsoft.Json.Linq;

/// <summary>
/// Dumps raw component data using EditorJsonUtility.
/// </summary>
public static class ComponentInspector
{
    [Serializable]
    public class RawComponentData
    {
        public int instanceId;
        public string type;
        public bool enabled;
        public object properties; // Parsed JSON object
    }

    /// <summary>
    /// Dump all components for a GameObject as raw JSON strings.
    /// </summary>
    public static RawComponentData[] DumpComponents(GameObject go)
    {
        var components = go.GetComponents<Component>();
        var result = new RawComponentData[components.Length];
        
        for (int i = 0; i < components.Length; i++)
        {
            var comp = components[i];
            var jsonString = comp != null ? EditorJsonUtility.ToJson(comp, false) : null;
            result[i] = new RawComponentData
            {
                instanceId = comp != null ? comp.GetInstanceID() : 0,
                type = comp != null ? comp.GetType().Name : "Missing",
                enabled = GetEnabled(comp),
                properties = jsonString != null ? JObject.Parse(jsonString) : null
            };
        }
        
        return result;
    }

    /// <summary>
    /// Dump a single component by instance ID.
    /// </summary>
    public static RawComponentData DumpComponent(int instanceId)
    {
        var obj = EditorUtility.InstanceIDToObject(instanceId);
        if (obj is Component comp)
        {
            var jsonString = EditorJsonUtility.ToJson(comp, false);
            return new RawComponentData
            {
                instanceId = comp.GetInstanceID(),
                type = comp.GetType().Name,
                enabled = GetEnabled(comp),
                properties = JObject.Parse(jsonString)
            };
        }
        return null;
    }

    private static bool GetEnabled(Component c)
    {
        if (c == null) return false;
        if (c is Behaviour b) return b.enabled;
        if (c is Renderer r) return r.enabled;
        if (c is Collider col) return col.enabled;
        return true;
    }
}
#endif