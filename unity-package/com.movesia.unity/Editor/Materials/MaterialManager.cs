#if UNITY_EDITOR
using UnityEngine;
using UnityEngine.Rendering;
using UnityEditor;
using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

/// <summary>
/// Unified Material operations for the AI agent.
/// Single smart endpoint: provide what you have, get what you need.
///   - No material reference? Creates one.
///   - Material reference (instanceId/assetPath)? Loads existing.
///   - Properties provided? Applies them.
///   - assignTo provided? Assigns to a Renderer.
/// Also provides shader discovery via ListShaders.
/// </summary>
public static class MaterialManager
{
    // =========================================================================
    // DATA STRUCTURES
    // =========================================================================

    [Serializable]
    public class MaterialResult
    {
        public bool success;
        public string error;

        // Material info (always populated on success)
        public int instanceId;
        public string name;
        public string assetPath;
        public string shaderName;

        // What operations were performed
        public bool created;
        public bool modified;
        public bool assigned;

        // Property modification details (only if properties were set)
        public int successCount;
        public int failCount;
        public MaterialPropertyResult[] propertyResults;

        // Assignment details (only if assignTo was provided)
        public AssignmentInfo assignment;
    }

    [Serializable]
    public class MaterialPropertyResult
    {
        public bool success;
        public string error;
        public string propertyName;
        public string propertyType; // "color", "float", "range", "int", "texture", "vector", "keyword", "renderQueue"
    }

    [Serializable]
    public class AssignmentInfo
    {
        public int rendererInstanceId;
        public string rendererName;
        public int slotIndex;
    }

    [Serializable]
    public class ShaderInfo
    {
        public string name;
        public int propertyCount;
        public ShaderPropertyInfo[] properties;
    }

    [Serializable]
    public class ShaderPropertyInfo
    {
        public string name;
        public string description;
        public string type; // "Color", "Float", "Range", "Texture", "Int", "Vector"
        public float rangeMin;
        public float rangeMax;
    }

    [Serializable]
    public class ListShadersResult
    {
        public bool success;
        public string error;
        public int count;
        public ShaderInfo[] shaders;
    }

    // =========================================================================
    // PROPERTY ALIAS DICTIONARY
    // =========================================================================

    /// <summary>
    /// Maps friendly/common property names to potential shader property names.
    /// URP names are listed first (since user's project uses URP), with built-in fallbacks.
    /// Resolution: first candidate that exists on the material's shader wins.
    /// </summary>
    private static readonly Dictionary<string, string[]> PropertyAliases =
        new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
    {
        // Colors
        { "color",           new[] { "_BaseColor", "_Color" } },
        { "baseColor",       new[] { "_BaseColor", "_Color" } },
        { "mainColor",       new[] { "_BaseColor", "_Color" } },
        { "albedo",          new[] { "_BaseColor", "_Color" } },
        { "emissionColor",   new[] { "_EmissionColor" } },
        { "specularColor",   new[] { "_SpecColor" } },

        // Textures
        { "mainTexture",     new[] { "_BaseMap", "_MainTex" } },
        { "baseMap",         new[] { "_BaseMap", "_MainTex" } },
        { "mainTex",         new[] { "_BaseMap", "_MainTex" } },
        { "albedoMap",       new[] { "_BaseMap", "_MainTex" } },
        { "normalMap",       new[] { "_BumpMap" } },
        { "bumpMap",         new[] { "_BumpMap" } },
        { "metallicMap",     new[] { "_MetallicGlossMap" } },
        { "occlusionMap",    new[] { "_OcclusionMap" } },
        { "emissionMap",     new[] { "_EmissionMap" } },
        { "detailMask",      new[] { "_DetailMask" } },
        { "detailAlbedo",    new[] { "_DetailAlbedoMap" } },
        { "detailNormal",    new[] { "_DetailNormalMap" } },

        // Floats
        { "metallic",            new[] { "_Metallic" } },
        { "smoothness",          new[] { "_Smoothness", "_Glossiness", "_GlossMapScale" } },
        { "glossiness",          new[] { "_Smoothness", "_Glossiness", "_GlossMapScale" } },
        { "bumpScale",           new[] { "_BumpScale" } },
        { "normalScale",         new[] { "_BumpScale" } },
        { "occlusionStrength",   new[] { "_OcclusionStrength" } },
        { "cutoff",              new[] { "_Cutoff" } },
        { "alphaCutoff",         new[] { "_Cutoff" } },
    };

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /// <summary>
    /// Resolve a property name to the actual shader property name.
    /// If aliased, tries each candidate until one exists on the material.
    /// If not aliased, returns the name as-is.
    /// </summary>
    private static string ResolvePropertyName(Material material, string name)
    {
        // If the material already has this exact property, use it directly
        if (material.HasProperty(name))
            return name;

        // Check alias dictionary
        if (PropertyAliases.TryGetValue(name, out string[] candidates))
        {
            foreach (var candidate in candidates)
            {
                if (material.HasProperty(candidate))
                    return candidate;
            }
            // None matched - return first candidate so error message shows what was tried
            return candidates[0];
        }

        // Not aliased, return as-is
        return name;
    }

    /// <summary>
    /// Normalize an asset path: ensure "Assets/" prefix and ".mat" extension.
    /// </summary>
    private static string NormalizeMaterialPath(string path)
    {
        if (!path.StartsWith("Assets"))
            path = "Assets/" + path.TrimStart('/');
        if (!path.EndsWith(".mat"))
            path += ".mat";
        return path;
    }

    /// <summary>
    /// Ensure all directories in a path exist, creating them via AssetDatabase if needed.
    /// </summary>
    private static void EnsureDirectoryExists(string assetPath)
    {
        string directory = Path.GetDirectoryName(assetPath)?.Replace('\\', '/');
        if (string.IsNullOrEmpty(directory) || AssetDatabase.IsValidFolder(directory))
            return;

        string[] parts = directory.Split('/');
        string currentPath = parts[0]; // "Assets"
        for (int i = 1; i < parts.Length; i++)
        {
            string newPath = currentPath + "/" + parts[i];
            if (!AssetDatabase.IsValidFolder(newPath))
            {
                AssetDatabase.CreateFolder(currentPath, parts[i]);
            }
            currentPath = newPath;
        }
    }

    /// <summary>
    /// Resolve a texture from either an instanceId (int), asset path (string), or object.
    /// Returns (texture, error). Error is null on success. Texture can be null (= clear texture).
    /// </summary>
    private static (Texture texture, string error) ResolveTexture(JToken value)
    {
        if (value == null || value.Type == JTokenType.Null)
            return (null, null); // Explicitly clearing the texture

        if (value.Type == JTokenType.Integer)
        {
            int instanceId = value.ToObject<int>();
            if (instanceId == 0)
                return (null, null);
            var obj = EditorUtility.EntityIdToObject(instanceId) as Texture;
            if (obj == null)
                return (null, $"Texture with instanceId {instanceId} not found");
            return (obj, null);
        }

        if (value.Type == JTokenType.String)
        {
            string path = value.ToString();
            if (!path.StartsWith("Assets"))
                path = "Assets/" + path.TrimStart('/');
            var tex = AssetDatabase.LoadAssetAtPath<Texture>(path);
            if (tex == null)
                return (null, $"Texture not found at path: {path}");
            return (tex, null);
        }

        if (value.Type == JTokenType.Object)
        {
            // Accept { "instanceId": 123 } or { "assetPath": "Assets/..." }
            var idProp = ((JObject)value).Properties()
                .FirstOrDefault(p => p.Name.Replace("_", "").Equals("instanceid", StringComparison.OrdinalIgnoreCase));
            if (idProp != null)
            {
                int instanceId = idProp.Value.ToObject<int>();
                var obj = EditorUtility.EntityIdToObject(instanceId) as Texture;
                if (obj == null)
                    return (null, $"Texture with instanceId {instanceId} not found");
                return (obj, null);
            }

            var pathProp = ((JObject)value).Properties()
                .FirstOrDefault(p => p.Name.Replace("_", "").Equals("assetpath", StringComparison.OrdinalIgnoreCase));
            if (pathProp != null)
            {
                string path = pathProp.Value.ToString();
                if (!path.StartsWith("Assets"))
                    path = "Assets/" + path.TrimStart('/');
                var tex = AssetDatabase.LoadAssetAtPath<Texture>(path);
                if (tex == null)
                    return (null, $"Texture not found at path: {path}");
                return (tex, null);
            }
        }

        return (null, "Texture value must be instanceId (int), assetPath (string), or { instanceId } / { assetPath }");
    }

    /// <summary>
    /// Set a single property on a material. Handles colors, floats, ints, textures, keywords, renderQueue.
    /// The propertyName should already be resolved (not an alias).
    /// </summary>
    private static MaterialPropertyResult SetMaterialProperty(
        Material material, string propertyName, JToken value, string originalName)
    {
        try
        {
            // Special case: renderQueue
            if (propertyName.Equals("renderQueue", StringComparison.OrdinalIgnoreCase))
            {
                material.renderQueue = value.ToObject<int>();
                return PropSuccess(originalName, "renderQueue");
            }

            // Special case: keyword toggle - "keyword:_EMISSION" or a bool for unknown property
            if (propertyName.StartsWith("keyword:", StringComparison.OrdinalIgnoreCase))
            {
                string keyword = propertyName.Substring("keyword:".Length);
                bool enable = value.ToObject<bool>();
                if (enable)
                    material.EnableKeyword(keyword);
                else
                    material.DisableKeyword(keyword);
                return PropSuccess(originalName, "keyword");
            }

            // Verify the property exists on the shader
            if (!material.HasProperty(propertyName))
            {
                return PropFail(originalName, $"Shader '{material.shader.name}' does not have property '{propertyName}'");
            }

            // Determine property type from the shader
            int propIndex = material.shader.FindPropertyIndex(propertyName);
            if (propIndex < 0)
            {
                return PropFail(originalName, $"Property '{propertyName}' index not found on shader");
            }

            var propType = material.shader.GetPropertyType(propIndex);

            switch (propType)
            {
                case ShaderPropertyType.Color:
                    var colorArr = value.ToObject<float[]>();
                    if (colorArr == null || colorArr.Length < 3)
                        return PropFail(originalName, "Color requires [r, g, b] or [r, g, b, a] array");
                    material.SetColor(propertyName, new Color(
                        colorArr[0], colorArr[1], colorArr[2],
                        colorArr.Length > 3 ? colorArr[3] : 1f));
                    return PropSuccess(originalName, "color");

                case ShaderPropertyType.Float:
                    material.SetFloat(propertyName, value.ToObject<float>());
                    return PropSuccess(originalName, "float");

                case ShaderPropertyType.Range:
                    material.SetFloat(propertyName, value.ToObject<float>());
                    return PropSuccess(originalName, "range");

#if UNITY_2022_1_OR_NEWER
                case ShaderPropertyType.Int:
                    material.SetInteger(propertyName, value.ToObject<int>());
                    return PropSuccess(originalName, "int");
#endif

                case ShaderPropertyType.Texture:
                    var (tex, texError) = ResolveTexture(value);
                    if (texError != null)
                        return PropFail(originalName, texError);
                    material.SetTexture(propertyName, tex);
                    return PropSuccess(originalName, "texture");

                case ShaderPropertyType.Vector:
                    var vecArr = value.ToObject<float[]>();
                    if (vecArr == null || vecArr.Length < 4)
                        return PropFail(originalName, "Vector requires [x, y, z, w] array");
                    material.SetVector(propertyName, new Vector4(vecArr[0], vecArr[1], vecArr[2], vecArr[3]));
                    return PropSuccess(originalName, "vector");

                default:
                    return PropFail(originalName, $"Unsupported shader property type: {propType}");
            }
        }
        catch (Exception ex)
        {
            return PropFail(originalName, ex.Message);
        }
    }

    private static MaterialPropertyResult PropSuccess(string name, string type)
    {
        return new MaterialPropertyResult { success = true, propertyName = name, propertyType = type };
    }

    private static MaterialPropertyResult PropFail(string name, string error)
    {
        return new MaterialPropertyResult { success = false, propertyName = name, error = error };
    }

    /// <summary>
    /// Apply properties and keywords to a material. Returns per-property results.
    /// </summary>
    private static (int successCount, int failCount, MaterialPropertyResult[] results) ApplyProperties(
        Material material,
        Dictionary<string, JToken> properties,
        Dictionary<string, bool> keywords)
    {
        var results = new List<MaterialPropertyResult>();
        int successCount = 0;
        int failCount = 0;

        if (properties != null)
        {
            foreach (var kvp in properties)
            {
                string resolved = ResolvePropertyName(material, kvp.Key);
                var result = SetMaterialProperty(material, resolved, kvp.Value, kvp.Key);
                results.Add(result);
                if (result.success) successCount++;
                else failCount++;
            }
        }

        if (keywords != null)
        {
            foreach (var kvp in keywords)
            {
                try
                {
                    if (kvp.Value)
                        material.EnableKeyword(kvp.Key);
                    else
                        material.DisableKeyword(kvp.Key);
                    results.Add(PropSuccess(kvp.Key, "keyword"));
                    successCount++;
                }
                catch (Exception ex)
                {
                    results.Add(PropFail(kvp.Key, ex.Message));
                    failCount++;
                }
            }
        }

        return (successCount, failCount, results.ToArray());
    }

    // =========================================================================
    // PUBLIC API — UNIFIED MATERIAL ENDPOINT
    // =========================================================================

    /// <summary>
    /// Smart unified material operation. Determines what to do based on what's provided:
    ///   - Has instanceId/assetPath? → Load existing material
    ///   - No material reference? → Create a new one (using shaderName, name, savePath)
    ///   - Has properties/keywords? → Modify the material
    ///   - Has assignTo? → Assign to a GameObject's Renderer
    /// All steps happen in a single call; each step is optional.
    /// </summary>
    public static MaterialResult ManageMaterial(
        // --- Identify existing material (skip = create new) ---
        int instanceId = 0,
        string assetPath = null,
        // --- Creation params (only used when creating new) ---
        string shaderName = null,
        string materialName = null,
        string savePath = null,
        // --- Modification params ---
        Dictionary<string, JToken> properties = null,
        Dictionary<string, bool> keywords = null,
        // --- Assignment params ---
        int assignToGameObject = 0,
        string assignToMaterialPath = null,
        int assignSlotIndex = 0)
    {
        try
        {
            Material material = null;
            bool didCreate = false;
            bool didModify = false;
            bool didAssign = false;
            string resolvedPath = null;

            // =================================================================
            // STEP 1: Resolve or Create the material
            // =================================================================

            // Try to load existing material
            if (instanceId != 0)
            {
                material = EditorUtility.EntityIdToObject(instanceId) as Material;
            }

            if (material == null && !string.IsNullOrEmpty(assetPath))
            {
                if (!assetPath.StartsWith("Assets"))
                    assetPath = "Assets/" + assetPath.TrimStart('/');
                material = AssetDatabase.LoadAssetAtPath<Material>(assetPath);
            }

            // No existing material found — create a new one
            if (material == null)
            {
                // Resolve shader
                Shader shader = null;

                if (!string.IsNullOrEmpty(shaderName))
                {
                    shader = Shader.Find(shaderName);
                    if (shader == null)
                    {
                        return new MaterialResult
                        {
                            success = false,
                            error = $"Shader not found: '{shaderName}'. Use list_shaders to discover available shaders."
                        };
                    }
                }
                else
                {
                    // Auto-detect: try URP Lit first, then Standard
                    shader = Shader.Find("Universal Render Pipeline/Lit");
                    if (shader == null)
                        shader = Shader.Find("Standard");
                    if (shader == null)
                    {
                        return new MaterialResult
                        {
                            success = false,
                            error = "Could not find URP Lit or Standard shader. Specify shaderName explicitly."
                        };
                    }
                }

                material = new Material(shader);

                if (!string.IsNullOrEmpty(materialName))
                    material.name = materialName;

                // Determine save path
                if (string.IsNullOrEmpty(savePath))
                {
                    string matName = materialName ?? "NewMaterial";
                    string matFolder = "Assets/Materials";
                    if (!AssetDatabase.IsValidFolder(matFolder))
                    {
                        AssetDatabase.CreateFolder("Assets", "Materials");
                    }
                    savePath = $"{matFolder}/{matName}.mat";
                }

                savePath = NormalizeMaterialPath(savePath);
                EnsureDirectoryExists(savePath);
                savePath = AssetDatabase.GenerateUniqueAssetPath(savePath);

                // Save as asset — Unity handles all GUID/serialization correctly
                AssetDatabase.CreateAsset(material, savePath);
                resolvedPath = savePath;
                didCreate = true;

                Debug.Log($"🎨 Created material '{material.name}' with shader '{shader.name}' at {savePath}");
            }
            else
            {
                resolvedPath = assetPath ?? AssetDatabase.GetAssetPath(material);
            }

            // =================================================================
            // STEP 2: Modify properties (if any provided)
            // =================================================================

            int successCount = 0;
            int failCount = 0;
            MaterialPropertyResult[] propertyResults = null;

            if (properties != null || keywords != null)
            {
                Undo.RecordObject(material, "Modify Material");

                var (sc, fc, results) = ApplyProperties(material, properties, keywords);
                successCount = sc;
                failCount = fc;
                propertyResults = results;
                didModify = true;

                Debug.Log($"🎨 Modified material '{material.name}': {successCount} ok, {failCount} failed");
            }

            // Save if we created or modified
            if (didCreate || didModify)
            {
                EditorUtility.SetDirty(material);
                AssetDatabase.SaveAssets();
            }

            // =================================================================
            // STEP 3: Assign to a GameObject's Renderer (if requested)
            // =================================================================

            AssignmentInfo assignmentInfo = null;

            if (assignToGameObject != 0)
            {
                var go = EditorUtility.EntityIdToObject(assignToGameObject) as GameObject;
                if (go == null)
                {
                    return new MaterialResult
                    {
                        success = false,
                        error = $"assignTo: GameObject with instanceId {assignToGameObject} not found",
                        instanceId = material.GetInstanceID(),
                        name = material.name,
                        assetPath = resolvedPath,
                        shaderName = material.shader.name,
                        created = didCreate,
                        modified = didModify,
                        assigned = false,
                        successCount = successCount,
                        failCount = failCount,
                        propertyResults = propertyResults
                    };
                }

                var renderer = go.GetComponent<Renderer>();
                if (renderer == null)
                {
                    return new MaterialResult
                    {
                        success = false,
                        error = $"assignTo: No Renderer component found on '{go.name}'",
                        instanceId = material.GetInstanceID(),
                        name = material.name,
                        assetPath = resolvedPath,
                        shaderName = material.shader.name,
                        created = didCreate,
                        modified = didModify,
                        assigned = false,
                        successCount = successCount,
                        failCount = failCount,
                        propertyResults = propertyResults
                    };
                }

                var materials = renderer.sharedMaterials;

                if (assignSlotIndex < 0)
                {
                    return new MaterialResult
                    {
                        success = false,
                        error = $"assignTo: slotIndex must be >= 0, got {assignSlotIndex}",
                        instanceId = material.GetInstanceID(),
                        name = material.name,
                        assetPath = resolvedPath,
                        shaderName = material.shader.name,
                        created = didCreate,
                        modified = didModify,
                        assigned = false
                    };
                }

                if (assignSlotIndex >= materials.Length)
                {
                    if (assignSlotIndex < 32)
                    {
                        var expanded = new Material[assignSlotIndex + 1];
                        for (int i = 0; i < materials.Length; i++)
                            expanded[i] = materials[i];
                        materials = expanded;
                    }
                    else
                    {
                        return new MaterialResult
                        {
                            success = false,
                            error = $"assignTo: slotIndex {assignSlotIndex} exceeds maximum (31)",
                            instanceId = material.GetInstanceID(),
                            name = material.name,
                            assetPath = resolvedPath,
                            shaderName = material.shader.name,
                            created = didCreate,
                            modified = didModify,
                            assigned = false
                        };
                    }
                }

                Undo.RecordObject(renderer, "Assign Material");
                materials[assignSlotIndex] = material;
                renderer.sharedMaterials = materials;
                didAssign = true;

                assignmentInfo = new AssignmentInfo
                {
                    rendererInstanceId = renderer.GetInstanceID(),
                    rendererName = go.name,
                    slotIndex = assignSlotIndex
                };

                Debug.Log($"🎨 Assigned material '{material.name}' to '{go.name}' slot {assignSlotIndex}");
            }

            // =================================================================
            // BUILD RESPONSE
            // =================================================================

            return new MaterialResult
            {
                success = failCount == 0,
                error = failCount > 0 ? $"{failCount} properties failed to set" : null,
                instanceId = material.GetInstanceID(),
                name = material.name,
                assetPath = resolvedPath,
                shaderName = material.shader.name,
                created = didCreate,
                modified = didModify,
                assigned = didAssign,
                successCount = successCount,
                failCount = failCount,
                propertyResults = propertyResults,
                assignment = assignmentInfo
            };
        }
        catch (Exception ex)
        {
            return new MaterialResult { success = false, error = ex.Message };
        }
    }

    // =========================================================================
    // PUBLIC API — LIST SHADERS (separate query endpoint)
    // =========================================================================

    /// <summary>
    /// List available shaders, optionally filtered by name.
    /// Returns shader names and their properties.
    /// </summary>
    public static ListShadersResult ListShaders(
        string filter = null,
        bool includeProperties = true,
        int limit = 50)
    {
        try
        {
            // Collect shader names from project assets
            var shaderNames = new HashSet<string>();

            var shaderGuids = AssetDatabase.FindAssets("t:Shader");
            foreach (var guid in shaderGuids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var shader = AssetDatabase.LoadAssetAtPath<Shader>(path);
                if (shader != null)
                    shaderNames.Add(shader.name);
            }

            // Add common built-in/URP shaders by trying to find them
            string[] commonShaders = new[]
            {
                "Universal Render Pipeline/Lit",
                "Universal Render Pipeline/Simple Lit",
                "Universal Render Pipeline/Unlit",
                "Universal Render Pipeline/Baked Lit",
                "Universal Render Pipeline/Particles/Lit",
                "Universal Render Pipeline/Particles/Simple Lit",
                "Universal Render Pipeline/Particles/Unlit",
                "Standard",
                "Standard (Specular setup)",
                "Unlit/Color",
                "Unlit/Texture",
                "Unlit/Transparent",
                "Unlit/Transparent Cutout",
                "Sprites/Default",
                "UI/Default",
                "Skybox/6 Sided",
                "Skybox/Procedural"
            };

            foreach (var name in commonShaders)
            {
                if (Shader.Find(name) != null)
                    shaderNames.Add(name);
            }

            // Filter and build results
            var shaders = new List<ShaderInfo>();

            foreach (var name in shaderNames.OrderBy(n => n))
            {
                if (!string.IsNullOrEmpty(filter) &&
                    name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0)
                    continue;

                if (shaders.Count >= limit)
                    break;

                var shader = Shader.Find(name);
                if (shader == null) continue;

                var info = new ShaderInfo
                {
                    name = name,
                    propertyCount = shader.GetPropertyCount()
                };

                if (includeProperties)
                {
                    var props = new List<ShaderPropertyInfo>();
                    for (int i = 0; i < shader.GetPropertyCount(); i++)
                    {
                        var propInfo = new ShaderPropertyInfo
                        {
                            name = shader.GetPropertyName(i),
                            description = shader.GetPropertyDescription(i),
                            type = shader.GetPropertyType(i).ToString()
                        };

                        if (shader.GetPropertyType(i) == ShaderPropertyType.Range)
                        {
                            var range = shader.GetPropertyRangeLimits(i);
                            propInfo.rangeMin = range.x;
                            propInfo.rangeMax = range.y;
                        }

                        props.Add(propInfo);
                    }
                    info.properties = props.ToArray();
                }

                shaders.Add(info);
            }

            return new ListShadersResult
            {
                success = true,
                count = shaders.Count,
                shaders = shaders.ToArray()
            };
        }
        catch (Exception ex)
        {
            return new ListShadersResult { success = false, error = ex.Message };
        }
    }
}
#endif
