#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using UnityEngine.SceneManagement;
using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

/// <summary>
/// Provides GameObject hierarchy manipulation with full Undo support.
/// </summary>
public static class HierarchyManipulator
{
    // --- Data Structures ---
    
    [Serializable]
    public class ManipulationResult
    {
        public bool success;
        public string error;
        public int instanceId;
        public string name;
    }

    [Serializable]
    public class PropertyResult
    {
        public bool success;
        public string error;
        public int componentInstanceId;
        public string componentType;
        public string propertyPath;
        public string propertyType;
        public object previousValue;
        public object newValue;
    }

    [Serializable]
    public class ModifyComponentResult
    {
        public bool success;
        public string error;
        public int componentInstanceId;
        public string componentType;
        public int successCount;
        public int failCount;
        public PropertyResult[] results;
    }

    // --- Create Operations ---

    /// <summary>
    /// Create a GameObject - empty or primitive, with optional transform.
    /// </summary>
    /// <param name="name">Name for the GameObject</param>
    /// <param name="primitive">Optional: Cube, Sphere, Capsule, Cylinder, Plane, Quad</param>
    /// <param name="parentInstanceId">Optional parent GameObject instanceId</param>
    /// <param name="position">Optional world/local position [x, y, z]</param>
    /// <param name="rotation">Optional euler rotation [x, y, z]</param>
    /// <param name="scale">Optional scale [x, y, z]</param>
    /// <param name="components">Optional array of component type names to add</param>
    public static ManipulationResult Create(
        string name = null,
        string primitive = null,
        int? parentInstanceId = null,
        float[] position = null,
        float[] rotation = null,
        float[] scale = null,
        string[] components = null)
    {
        try
        {
            GameObject go;

            // Create primitive or empty
            if (!string.IsNullOrEmpty(primitive))
            {
                if (!Enum.TryParse<PrimitiveType>(primitive, true, out var type))
                {
                    return new ManipulationResult
                    {
                        success = false,
                        error = $"Invalid primitive: {primitive}. Valid: Cube, Sphere, Capsule, Cylinder, Plane, Quad"
                    };
                }
                go = GameObject.CreatePrimitive(type);
                Undo.RegisterCreatedObjectUndo(go, $"Create {type}");

                // Set name (primitives get their type as default name)
                if (!string.IsNullOrEmpty(name))
                    go.name = name;
            }
            else
            {
                // Empty GameObject
                go = ObjectFactory.CreateGameObject(name ?? "GameObject");
            }

            // Set parent
            if (parentInstanceId.HasValue)
            {
                var parent = EditorUtility.InstanceIDToObject(parentInstanceId.Value) as GameObject;
                if (parent != null)
                {
                    Undo.SetTransformParent(go.transform, parent.transform, "Set Parent");
                }
            }

            // Apply transform
            if (position != null && position.Length >= 3)
                go.transform.localPosition = new Vector3(position[0], position[1], position[2]);

            if (rotation != null && rotation.Length >= 3)
                go.transform.localEulerAngles = new Vector3(rotation[0], rotation[1], rotation[2]);

            if (scale != null && scale.Length >= 3)
                go.transform.localScale = new Vector3(scale[0], scale[1], scale[2]);

            // Add components
            if (components != null && components.Length > 0)
            {
                foreach (var compType in components)
                {
                    var type = FindComponentType(compType);
                    if (type != null)
                    {
                        Undo.AddComponent(go, type);
                    }
                }
            }

            Selection.activeGameObject = go;

            return new ManipulationResult
            {
                success = true,
                instanceId = go.GetInstanceID(),
                name = go.name
            };
        }
        catch (Exception ex)
        {
            return new ManipulationResult { success = false, error = ex.Message };
        }
    }

    /// <summary>
    /// Find a Component type by name.
    /// </summary>
    private static Type FindComponentType(string typeName)
    {
        // Try common Unity components first
        var type = Type.GetType($"UnityEngine.{typeName}, UnityEngine.CoreModule");
        if (type != null && typeof(Component).IsAssignableFrom(type))
            return type;

        // Try TypeCache for all components
        var types = TypeCache.GetTypesDerivedFrom<Component>();

        // Exact match
        foreach (var t in types)
        {
            if (t.Name == typeName)
                return t;
        }

        // Case-insensitive match
        foreach (var t in types)
        {
            if (t.Name.Equals(typeName, StringComparison.OrdinalIgnoreCase))
                return t;
        }

        return null;
    }

    /// <summary>
    /// Duplicate a GameObject.
    /// </summary>
    public static ManipulationResult Duplicate(int instanceId)
    {
        try
        {
            var go = EditorUtility.InstanceIDToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new ManipulationResult { success = false, error = "GameObject not found" };
            }
            
            // GameObjectUtility.DuplicateGameObject is 2023.1+
            // Fallback to Instantiate + Undo for older versions
            #if UNITY_2023_1_OR_NEWER
            var duplicate = GameObjectUtility.DuplicateGameObject(go);
            #else
            var duplicate = UnityEngine.Object.Instantiate(go, go.transform.parent);
            duplicate.name = go.name;
            Undo.RegisterCreatedObjectUndo(duplicate, $"Duplicate {go.name}");
            #endif
            
            Selection.activeGameObject = duplicate;
            
            return new ManipulationResult
            {
                success = true,
                instanceId = duplicate.GetInstanceID(),
                name = duplicate.name
            };
        }
        catch (Exception ex)
        {
            return new ManipulationResult { success = false, error = ex.Message };
        }
    }
    
    /// <summary>
    /// Destroy a GameObject with Undo support.
    /// </summary>
    public static ManipulationResult Destroy(int instanceId)
    {
        try
        {
            var go = EditorUtility.InstanceIDToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new ManipulationResult { success = false, error = "GameObject not found" };
            }
            
            string name = go.name;
            Undo.DestroyObjectImmediate(go);
            
            return new ManipulationResult
            {
                success = true,
                instanceId = instanceId,
                name = name
            };
        }
        catch (Exception ex)
        {
            return new ManipulationResult { success = false, error = ex.Message };
        }
    }
    
    /// <summary>
    /// Rename a GameObject.
    /// </summary>
    public static ManipulationResult Rename(int instanceId, string newName)
    {
        try
        {
            var go = EditorUtility.InstanceIDToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new ManipulationResult { success = false, error = "GameObject not found" };
            }
            
            Undo.RecordObject(go, "Rename GameObject");
            go.name = newName;
            
            return new ManipulationResult
            {
                success = true,
                instanceId = instanceId,
                name = go.name
            };
        }
        catch (Exception ex)
        {
            return new ManipulationResult { success = false, error = ex.Message };
        }
    }
    
    /// <summary>
    /// Set parent of a GameObject.
    /// </summary>
    public static ManipulationResult SetParent(int instanceId, int? parentInstanceId, bool worldPositionStays = true)
    {
        try
        {
            var go = EditorUtility.InstanceIDToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new ManipulationResult { success = false, error = "GameObject not found" };
            }
            
            Transform newParent = null;
            if (parentInstanceId.HasValue)
            {
                var parentGo = EditorUtility.InstanceIDToObject(parentInstanceId.Value) as GameObject;
                if (parentGo == null)
                {
                    return new ManipulationResult { success = false, error = "Parent GameObject not found" };
                }
                newParent = parentGo.transform;
            }
            
            Undo.SetTransformParent(go.transform, newParent, worldPositionStays, "Set Parent");
            
            return new ManipulationResult
            {
                success = true,
                instanceId = instanceId,
                name = go.name
            };
        }
        catch (Exception ex)
        {
            return new ManipulationResult { success = false, error = ex.Message };
        }
    }
    
    /// <summary>
    /// Set sibling index (reorder in hierarchy).
    /// </summary>
    public static ManipulationResult SetSiblingIndex(int instanceId, int siblingIndex)
    {
        try
        {
            var go = EditorUtility.InstanceIDToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new ManipulationResult { success = false, error = "GameObject not found" };
            }
            
            Undo.SetSiblingIndex(go.transform, siblingIndex, "Reorder GameObject");
            
            return new ManipulationResult
            {
                success = true,
                instanceId = instanceId,
                name = go.name
            };
        }
        catch (Exception ex)
        {
            return new ManipulationResult { success = false, error = ex.Message };
        }
    }
    
    /// <summary>
    /// Move GameObject to another scene. Must be a root object.
    /// </summary>
    public static ManipulationResult MoveToScene(int instanceId, string sceneName)
    {
        try
        {
            var go = EditorUtility.InstanceIDToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new ManipulationResult { success = false, error = "GameObject not found" };
            }
            
            if (go.transform.parent != null)
            {
                return new ManipulationResult { success = false, error = "GameObject must be at root of current scene" };
            }
            
            var scene = SceneManager.GetSceneByName(sceneName);
            if (!scene.IsValid() || !scene.isLoaded)
            {
                return new ManipulationResult { success = false, error = $"Scene '{sceneName}' not found or not loaded" };
            }
            
            Undo.MoveGameObjectToScene(go, scene, "Move to Scene");
            
            return new ManipulationResult
            {
                success = true,
                instanceId = instanceId,
                name = go.name
            };
        }
        catch (Exception ex)
        {
            return new ManipulationResult { success = false, error = ex.Message };
        }
    }
    
    /// <summary>
    /// Set GameObject active state.
    /// </summary>
    public static ManipulationResult SetActive(int instanceId, bool active)
    {
        try
        {
            var go = EditorUtility.InstanceIDToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new ManipulationResult { success = false, error = "GameObject not found" };
            }
            
            Undo.RecordObject(go, active ? "Activate GameObject" : "Deactivate GameObject");
            go.SetActive(active);
            
            return new ManipulationResult
            {
                success = true,
                instanceId = instanceId,
                name = go.name
            };
        }
        catch (Exception ex)
        {
            return new ManipulationResult { success = false, error = ex.Message };
        }
    }
    
    /// <summary>
    /// Set Transform position/rotation/scale.
    /// </summary>
    public static ManipulationResult SetTransform(
        int instanceId, 
        float[] position = null, 
        float[] rotation = null, 
        float[] scale = null,
        bool local = true)
    {
        try
        {
            var go = EditorUtility.InstanceIDToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new ManipulationResult { success = false, error = "GameObject not found" };
            }
            
            Undo.RecordObject(go.transform, "Modify Transform");
            
            if (position != null && position.Length >= 3)
            {
                var pos = new Vector3(position[0], position[1], position[2]);
                if (local) go.transform.localPosition = pos;
                else go.transform.position = pos;
            }
            
            if (rotation != null && rotation.Length >= 3)
            {
                var rot = Quaternion.Euler(rotation[0], rotation[1], rotation[2]);
                if (local) go.transform.localRotation = rot;
                else go.transform.rotation = rot;
            }
            
            if (scale != null && scale.Length >= 3)
            {
                go.transform.localScale = new Vector3(scale[0], scale[1], scale[2]);
            }
            
            return new ManipulationResult
            {
                success = true,
                instanceId = instanceId,
                name = go.name
            };
        }
        catch (Exception ex)
        {
            return new ManipulationResult { success = false, error = ex.Message };
        }
    }
    
    /// <summary>
    /// Add a component to a GameObject.
    /// </summary>
    public static ManipulationResult AddComponent(int instanceId, string componentType)
    {
        try
        {
            var go = EditorUtility.InstanceIDToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new ManipulationResult { success = false, error = "GameObject not found" };
            }
            
            // Use FindComponentType which searches all loaded assemblies via TypeCache
            var type = FindComponentType(componentType);
            
            if (type == null)
            {
                return new ManipulationResult { success = false, error = $"Component type '{componentType}' not found" };
            }
            
            var component = Undo.AddComponent(go, type);
            
            return new ManipulationResult
            {
                success = true,
                instanceId = component.GetInstanceID(),
                name = type.Name
            };
        }
        catch (Exception ex)
        {
            return new ManipulationResult { success = false, error = ex.Message };
        }
    }
    
    /// <summary>
    /// Remove a component from a GameObject.
    /// </summary>
    public static ManipulationResult RemoveComponent(int componentInstanceId)
    {
        try
        {
            var component = EditorUtility.InstanceIDToObject(componentInstanceId) as Component;
            if (component == null)
            {
                return new ManipulationResult { success = false, error = "Component not found" };
            }
            
            if (component is Transform)
            {
                return new ManipulationResult { success = false, error = "Cannot remove Transform component" };
            }
            
            string typeName = component.GetType().Name;
            Undo.DestroyObjectImmediate(component);
            
            return new ManipulationResult
            {
                success = true,
                instanceId = componentInstanceId,
                name = typeName
            };
        }
        catch (Exception ex)
        {
            return new ManipulationResult { success = false, error = ex.Message };
        }
    }

    // ===========================================
    // Component Property Modification Operations
    // ===========================================

    /// <summary>
    /// Modify component properties. Accepts EITHER:
    /// - componentInstanceId directly
    /// - gameObjectInstanceId + componentType (auto-resolves the component)
    /// </summary>
    /// <param name="componentInstanceId">Instance ID of the component (use 0 if using gameObjectInstanceId + componentType)</param>
    /// <param name="properties">Dictionary of propertyPath -> value</param>
    /// <param name="gameObjectInstanceId">Instance ID of the GameObject (alternative to componentInstanceId)</param>
    /// <param name="componentType">Type name of the component to find on the GameObject</param>
    /// <param name="componentIndex">Index when multiple components of the same type exist (default 0)</param>
    public static ModifyComponentResult ModifyComponent(
        int componentInstanceId,
        Dictionary<string, JToken> properties,
        int gameObjectInstanceId = 0,
        string componentType = null,
        int componentIndex = 0)
    {
        var results = new List<PropertyResult>();
        int successCount = 0;
        int failCount = 0;

        try
        {
            Component component = null;

            // Option 1: Direct component ID
            if (componentInstanceId != 0)
            {
                component = EditorUtility.InstanceIDToObject(componentInstanceId) as Component;
            }
            // Option 2: Resolve from GameObject + type
            else if (gameObjectInstanceId != 0 && !string.IsNullOrEmpty(componentType))
            {
                var go = EditorUtility.InstanceIDToObject(gameObjectInstanceId) as GameObject;
                if (go == null)
                {
                    return new ModifyComponentResult
                    {
                        success = false,
                        error = $"GameObject with ID {gameObjectInstanceId} not found",
                        componentInstanceId = 0,
                        successCount = 0,
                        failCount = properties.Count,
                        results = Array.Empty<PropertyResult>()
                    };
                }

                var type = FindComponentType(componentType);
                if (type == null)
                {
                    return new ModifyComponentResult
                    {
                        success = false,
                        error = $"Component type '{componentType}' not found. Check spelling (case-insensitive).",
                        componentInstanceId = 0,
                        successCount = 0,
                        failCount = properties.Count,
                        results = Array.Empty<PropertyResult>()
                    };
                }

                // Get component(s) - handle multiple of same type
                var components = go.GetComponents(type);
                if (components.Length == 0)
                {
                    return new ModifyComponentResult
                    {
                        success = false,
                        error = $"No {componentType} component found on '{go.name}'",
                        componentInstanceId = 0,
                        successCount = 0,
                        failCount = properties.Count,
                        results = Array.Empty<PropertyResult>()
                    };
                }

                if (componentIndex >= components.Length)
                {
                    return new ModifyComponentResult
                    {
                        success = false,
                        error = $"componentIndex {componentIndex} out of range. GameObject has {components.Length} {componentType}(s).",
                        componentInstanceId = 0,
                        successCount = 0,
                        failCount = properties.Count,
                        results = Array.Empty<PropertyResult>()
                    };
                }

                component = components[componentIndex];
            }

            if (component == null)
            {
                return new ModifyComponentResult
                {
                    success = false,
                    error = "Component not found. Provide either componentInstanceId OR (gameObjectInstanceId + componentType)",
                    componentInstanceId = componentInstanceId,
                    successCount = 0,
                    failCount = properties.Count,
                    results = Array.Empty<PropertyResult>()
                };
            }

            // Get the resolved component's instance ID for the response
            int resolvedComponentId = component.GetInstanceID();

            // Create SerializedObject wrapper
            var serializedObject = new SerializedObject(component);

            foreach (var kvp in properties)
            {
                string propertyPath = kvp.Key;
                JToken value = kvp.Value;

                var property = serializedObject.FindProperty(propertyPath);
                if (property == null)
                {
                    results.Add(new PropertyResult
                    {
                        success = false,
                        error = $"Property '{propertyPath}' not found",
                        componentInstanceId = resolvedComponentId,
                        componentType = component.GetType().Name,
                        propertyPath = propertyPath
                    });
                    failCount++;
                    continue;
                }

                object previousValue = GetPropertyValue(property);
                string setError = SetPropertyValue(property, value);

                if (setError != null)
                {
                    results.Add(new PropertyResult
                    {
                        success = false,
                        error = setError,
                        componentInstanceId = resolvedComponentId,
                        componentType = component.GetType().Name,
                        propertyPath = propertyPath,
                        propertyType = property.propertyType.ToString()
                    });
                    failCount++;
                }
                else
                {
                    results.Add(new PropertyResult
                    {
                        success = true,
                        componentInstanceId = resolvedComponentId,
                        componentType = component.GetType().Name,
                        propertyPath = propertyPath,
                        propertyType = property.propertyType.ToString(),
                        previousValue = previousValue
                    });
                    successCount++;
                }
            }

            // Apply all changes at once
            serializedObject.ApplyModifiedProperties();

            // Update new values in results
            serializedObject.Update();
            for (int i = 0; i < results.Count; i++)
            {
                if (results[i].success)
                {
                    var property = serializedObject.FindProperty(results[i].propertyPath);
                    if (property != null)
                    {
                        results[i].newValue = GetPropertyValue(property);
                    }
                }
            }

            serializedObject.Dispose();

            return new ModifyComponentResult
            {
                success = failCount == 0,
                error = failCount > 0 ? $"{failCount} properties failed to set" : null,
                componentInstanceId = resolvedComponentId,
                componentType = component.GetType().Name,
                successCount = successCount,
                failCount = failCount,
                results = results.ToArray()
            };
        }
        catch (Exception ex)
        {
            return new ModifyComponentResult
            {
                success = false,
                error = ex.Message,
                componentInstanceId = componentInstanceId,
                successCount = successCount,
                failCount = failCount + (properties.Count - successCount - failCount),
                results = results.ToArray()
            };
        }
    }

    // ===========================================
    // Private Helper Methods for Property Access
    // ===========================================

    /// <summary>
    /// Get the current value of a SerializedProperty as a boxed object.
    /// </summary>
    private static object GetPropertyValue(SerializedProperty property)
    {
        switch (property.propertyType)
        {
            case SerializedPropertyType.Integer:
                return property.intValue;
            
            case SerializedPropertyType.Boolean:
                return property.boolValue;
            
            case SerializedPropertyType.Float:
                // Check if it's actually a double
                if (property.type == "double")
                    return property.doubleValue;
                return property.floatValue;
            
            case SerializedPropertyType.String:
                return property.stringValue;
            
            case SerializedPropertyType.Color:
                var c = property.colorValue;
                return new float[] { c.r, c.g, c.b, c.a };
            
            case SerializedPropertyType.Vector2:
                var v2 = property.vector2Value;
                return new float[] { v2.x, v2.y };
            
            case SerializedPropertyType.Vector3:
                var v3 = property.vector3Value;
                return new float[] { v3.x, v3.y, v3.z };
            
            case SerializedPropertyType.Vector4:
                var v4 = property.vector4Value;
                return new float[] { v4.x, v4.y, v4.z, v4.w };
            
            case SerializedPropertyType.Quaternion:
                var q = property.quaternionValue;
                return new float[] { q.x, q.y, q.z, q.w };
            
            case SerializedPropertyType.Rect:
                var r = property.rectValue;
                return new float[] { r.x, r.y, r.width, r.height };
            
            case SerializedPropertyType.Bounds:
                var b = property.boundsValue;
                return new float[] { b.center.x, b.center.y, b.center.z, b.size.x, b.size.y, b.size.z };
            
            case SerializedPropertyType.Vector2Int:
                var v2i = property.vector2IntValue;
                return new int[] { v2i.x, v2i.y };
            
            case SerializedPropertyType.Vector3Int:
                var v3i = property.vector3IntValue;
                return new int[] { v3i.x, v3i.y, v3i.z };
            
            case SerializedPropertyType.RectInt:
                var ri = property.rectIntValue;
                return new int[] { ri.x, ri.y, ri.width, ri.height };
            
            case SerializedPropertyType.BoundsInt:
                var bi = property.boundsIntValue;
                return new int[] { bi.position.x, bi.position.y, bi.position.z, bi.size.x, bi.size.y, bi.size.z };
            
            case SerializedPropertyType.Enum:
                return property.enumValueIndex;
            
            case SerializedPropertyType.LayerMask:
                return property.intValue;
            
            case SerializedPropertyType.ObjectReference:
                if (property.objectReferenceValue != null)
                    return new { instanceId = property.objectReferenceValue.GetInstanceID(), name = property.objectReferenceValue.name };
                return null;
            
            case SerializedPropertyType.ArraySize:
                return property.intValue;
            
            default:
                return $"<{property.propertyType}>";
        }
    }

    /// <summary>
    /// Set the value of a SerializedProperty from a JToken.
    /// Returns null on success, or an error message on failure.
    /// </summary>
    public static string SetPropertyValue(SerializedProperty property, JToken value)
    {
        try
        {
            switch (property.propertyType)
            {
                case SerializedPropertyType.Integer:
                    property.intValue = value.ToObject<int>();
                    return null;
                
                case SerializedPropertyType.Boolean:
                    property.boolValue = value.ToObject<bool>();
                    return null;
                
                case SerializedPropertyType.Float:
                    if (property.type == "double")
                        property.doubleValue = value.ToObject<double>();
                    else
                        property.floatValue = value.ToObject<float>();
                    return null;
                
                case SerializedPropertyType.String:
                    property.stringValue = value.ToString();
                    return null;
                
                case SerializedPropertyType.Color:
                    var colorArr = value.ToObject<float[]>();
                    if (colorArr == null || colorArr.Length < 3)
                        return "Color requires array of 3-4 floats [r, g, b] or [r, g, b, a]";
                    property.colorValue = new Color(
                        colorArr[0], 
                        colorArr[1], 
                        colorArr[2], 
                        colorArr.Length > 3 ? colorArr[3] : 1f
                    );
                    return null;
                
                case SerializedPropertyType.Vector2:
                    var v2Arr = value.ToObject<float[]>();
                    if (v2Arr == null || v2Arr.Length < 2)
                        return "Vector2 requires array of 2 floats [x, y]";
                    property.vector2Value = new Vector2(v2Arr[0], v2Arr[1]);
                    return null;
                
                case SerializedPropertyType.Vector3:
                    var v3Arr = value.ToObject<float[]>();
                    if (v3Arr == null || v3Arr.Length < 3)
                        return "Vector3 requires array of 3 floats [x, y, z]";
                    property.vector3Value = new Vector3(v3Arr[0], v3Arr[1], v3Arr[2]);
                    return null;
                
                case SerializedPropertyType.Vector4:
                    var v4Arr = value.ToObject<float[]>();
                    if (v4Arr == null || v4Arr.Length < 4)
                        return "Vector4 requires array of 4 floats [x, y, z, w]";
                    property.vector4Value = new Vector4(v4Arr[0], v4Arr[1], v4Arr[2], v4Arr[3]);
                    return null;
                
                case SerializedPropertyType.Quaternion:
                    // Accept either euler angles [x, y, z] or quaternion [x, y, z, w]
                    var qArr = value.ToObject<float[]>();
                    if (qArr == null || qArr.Length < 3)
                        return "Quaternion requires array of 3 floats (euler) or 4 floats (xyzw)";
                    if (qArr.Length == 3)
                        property.quaternionValue = Quaternion.Euler(qArr[0], qArr[1], qArr[2]);
                    else
                        property.quaternionValue = new Quaternion(qArr[0], qArr[1], qArr[2], qArr[3]);
                    return null;
                
                case SerializedPropertyType.Rect:
                    var rectArr = value.ToObject<float[]>();
                    if (rectArr == null || rectArr.Length < 4)
                        return "Rect requires array of 4 floats [x, y, width, height]";
                    property.rectValue = new Rect(rectArr[0], rectArr[1], rectArr[2], rectArr[3]);
                    return null;
                
                case SerializedPropertyType.Bounds:
                    var boundsArr = value.ToObject<float[]>();
                    if (boundsArr == null || boundsArr.Length < 6)
                        return "Bounds requires array of 6 floats [centerX, centerY, centerZ, sizeX, sizeY, sizeZ]";
                    property.boundsValue = new Bounds(
                        new Vector3(boundsArr[0], boundsArr[1], boundsArr[2]),
                        new Vector3(boundsArr[3], boundsArr[4], boundsArr[5])
                    );
                    return null;
                
                case SerializedPropertyType.Vector2Int:
                    var v2iArr = value.ToObject<int[]>();
                    if (v2iArr == null || v2iArr.Length < 2)
                        return "Vector2Int requires array of 2 ints [x, y]";
                    property.vector2IntValue = new Vector2Int(v2iArr[0], v2iArr[1]);
                    return null;
                
                case SerializedPropertyType.Vector3Int:
                    var v3iArr = value.ToObject<int[]>();
                    if (v3iArr == null || v3iArr.Length < 3)
                        return "Vector3Int requires array of 3 ints [x, y, z]";
                    property.vector3IntValue = new Vector3Int(v3iArr[0], v3iArr[1], v3iArr[2]);
                    return null;
                
                case SerializedPropertyType.RectInt:
                    var riArr = value.ToObject<int[]>();
                    if (riArr == null || riArr.Length < 4)
                        return "RectInt requires array of 4 ints [x, y, width, height]";
                    property.rectIntValue = new RectInt(riArr[0], riArr[1], riArr[2], riArr[3]);
                    return null;
                
                case SerializedPropertyType.BoundsInt:
                    var biArr = value.ToObject<int[]>();
                    if (biArr == null || biArr.Length < 6)
                        return "BoundsInt requires array of 6 ints [posX, posY, posZ, sizeX, sizeY, sizeZ]";
                    property.boundsIntValue = new BoundsInt(
                        new Vector3Int(biArr[0], biArr[1], biArr[2]),
                        new Vector3Int(biArr[3], biArr[4], biArr[5])
                    );
                    return null;
                
                case SerializedPropertyType.Enum:
                    // Accept either index (int) or name (string)
                    if (value.Type == JTokenType.Integer)
                    {
                        property.enumValueIndex = value.ToObject<int>();
                    }
                    else if (value.Type == JTokenType.String)
                    {
                        var enumName = value.ToString();
                        var names = property.enumNames;
                        int index = Array.IndexOf(names, enumName);
                        if (index < 0)
                            return $"Invalid enum value '{enumName}'. Valid values: {string.Join(", ", names)}";
                        property.enumValueIndex = index;
                    }
                    else
                    {
                        return "Enum requires int (index) or string (name)";
                    }
                    return null;
                
                case SerializedPropertyType.LayerMask:
                    property.intValue = value.ToObject<int>();
                    return null;
                
                case SerializedPropertyType.ObjectReference:
                    // Accept instanceId to set object reference
                    if (value.Type == JTokenType.Null)
                    {
                        property.objectReferenceValue = null;
                        return null;
                    }
                    else if (value.Type == JTokenType.Integer)
                    {
                        int instanceId = value.ToObject<int>();
                        if (instanceId == 0)
                        {
                            property.objectReferenceValue = null;
                            return null;
                        }
                        var obj = EditorUtility.InstanceIDToObject(instanceId);
                        if (obj == null)
                            return $"Object with instanceId {instanceId} not found";
                        property.objectReferenceValue = obj;
                        return null;
                    }
                    else if (value.Type == JTokenType.Object)
                    {
                        var instanceId = value["instanceId"]?.ToObject<int>() ?? 0;
                        if (instanceId == 0)
                        {
                            property.objectReferenceValue = null;
                            return null;
                        }
                        var obj = EditorUtility.InstanceIDToObject(instanceId);
                        if (obj == null)
                            return $"Object with instanceId {instanceId} not found";
                        property.objectReferenceValue = obj;
                        return null;
                    }
                    return "ObjectReference requires instanceId (int) or { instanceId: int }";
                
                case SerializedPropertyType.ArraySize:
                    property.arraySize = value.ToObject<int>();
                    return null;
                
                case SerializedPropertyType.AnimationCurve:
                    // AnimationCurve is complex - accept simplified format
                    // For now, just return unsupported
                    return "AnimationCurve modification not yet supported";
                
                case SerializedPropertyType.Gradient:
                    return "Gradient modification not yet supported";
                
                case SerializedPropertyType.ExposedReference:
                    return "ExposedReference modification not yet supported";
                
                case SerializedPropertyType.ManagedReference:
                    return "ManagedReference modification not yet supported";
                
                default:
                    return $"Property type '{property.propertyType}' is not supported for modification";
            }
        }
        catch (Exception ex)
        {
            return $"Failed to set value: {ex.Message}";
        }
    }
}
#endif