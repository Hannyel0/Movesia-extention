#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

/// <summary>
/// Provides Prefab manipulation and query operations for the AI agent.
/// Includes a unified smart endpoint (ManagePrefab) that chains sequential
/// phases based on the fields provided — modeled after MaterialManager.
///
/// Phase 1 — Resolve/obtain the prefab (pick one):
///   • prefabName                   → INSTANTIATE by name search
///   • assetPath (no modify fields) → INSTANTIATE by path
///   • instanceId + savePath        → CREATE prefab from scene GO
///   • assetPath + modify fields    → resolve path only (skip to Phase 2)
///   • instanceId alone             → APPLY overrides to prefab asset
///
/// Phase 2 — Modify (optional, chains after Phase 1):
///   • componentType + properties   → MODIFY component on the prefab asset
///
/// Compound operations in a single call:
///   - Create + Modify:  instanceId + savePath + componentType + properties
///   - Instantiate + Modify:  prefabName + componentType + properties
///   - Modify only:  assetPath + componentType + properties
/// </summary>
public static class PrefabManager
{
    // --- Data Structures ---

    [Serializable]
    public class PrefabResult
    {
        public bool success;
        public string error;
        public int instanceId;
        public string name;
        public string assetPath;
    }

    [Serializable]
    public class PrefabInfo
    {
        public string name;
        public string assetPath;
        public string guid;
        public bool isVariant;
        public string[] labels;
    }

    [Serializable]
    public class PrefabListResult
    {
        public bool success;
        public string error;
        public int count;
        public PrefabInfo[] prefabs;
    }

    [Serializable]
    public class ModifyPrefabResult
    {
        public bool success;
        public string error;
        public string assetPath;
        public string targetPath;
        public string componentType;
        public int successCount;
        public int failCount;
        public HierarchyManipulator.PropertyResult[] results;
    }

    /// <summary>
    /// Unified result for the smart prefab endpoint.
    /// Reports which phases were executed (like MaterialManager).
    /// </summary>
    [Serializable]
    public class UnifiedPrefabResult
    {
        public bool success;
        public string error;

        // Prefab / GameObject info (always populated on success)
        public int instanceId;
        public string name;
        public string assetPath;

        // Which phases were performed
        public bool instantiated;
        public bool created;
        public bool modified;
        public bool applied;

        // Modification details (only when modified == true)
        public string targetPath;
        public string componentType;
        public int successCount;
        public int failCount;
        public HierarchyManipulator.PropertyResult[] propertyResults;
    }

    // =========================================================================
    // PUBLIC API — UNIFIED PREFAB ENDPOINT
    // =========================================================================

    /// <summary>
    /// Smart unified prefab operation. Phases execute sequentially, each is optional:
    ///
    /// PHASE 1 — Resolve or obtain the prefab asset (pick one):
    ///   • prefabName present                   → INSTANTIATE by name search
    ///   • assetPath present (no create fields)  → INSTANTIATE by path
    ///   • instanceId + savePath                 → CREATE prefab from scene GO
    ///   • instanceId alone                      → APPLY overrides to prefab asset
    ///
    /// PHASE 2 — Modify (chains after Phase 1 if componentType + properties present):
    ///   • Uses the assetPath resolved from Phase 1 (or provided directly)
    ///   • Modifies component properties on the prefab asset
    ///
    /// This means you can do compound operations in a single call:
    ///   - "Create prefab from GO + modify its Rigidbody"
    ///   - "Instantiate prefab + modify its collider on the asset"
    ///   - "Just modify" (assetPath + componentType + properties, no instantiation)
    ///
    /// All via a single "prefab" message type.
    /// </summary>
    public static UnifiedPrefabResult ManagePrefab(
        // --- Identify target ---
        int instanceId = 0,
        string assetPath = null,
        string prefabName = null,
        // --- Instantiation params ---
        int? parentInstanceId = null,
        float[] position = null,
        float[] rotation = null,
        float[] scale = null,
        // --- Creation params ---
        string savePath = null,
        // --- Modification params ---
        string componentType = null,
        string targetPath = null,
        Dictionary<string, JToken> properties = null)
    {
        try
        {
            string resolvedAssetPath = null;
            int resolvedInstanceId = 0;
            string resolvedName = null;
            bool didInstantiate = false;
            bool didCreate = false;
            bool didModify = false;
            bool didApply = false;

            bool hasModifyFields = !string.IsNullOrEmpty(componentType)
                                   && properties != null && properties.Count > 0;

            // =============================================================
            // PHASE 1: Resolve or obtain the prefab asset
            // =============================================================

            // 1a. Has prefabName → INSTANTIATE by name search
            if (!string.IsNullOrEmpty(prefabName))
            {
                var result = InstantiatePrefabByName(prefabName, parentInstanceId, position, rotation, scale);
                if (!result.success)
                    return Fail(result.error);

                resolvedInstanceId = result.instanceId;
                resolvedName = result.name;
                resolvedAssetPath = result.assetPath;
                didInstantiate = true;
            }
            // 1b. Has instanceId + savePath → CREATE prefab from scene GO
            else if (instanceId != 0 && !string.IsNullOrEmpty(savePath))
            {
                var result = CreatePrefabFromGameObject(instanceId, savePath);
                if (!result.success)
                    return Fail(result.error);

                resolvedInstanceId = result.instanceId;
                resolvedName = result.name;
                resolvedAssetPath = result.assetPath;
                didCreate = true;
            }
            // 1c. Has assetPath → INSTANTIATE by path (only if no modify-only intent)
            else if (!string.IsNullOrEmpty(assetPath) && !hasModifyFields)
            {
                var result = InstantiatePrefab(assetPath, parentInstanceId, position, rotation, scale);
                if (!result.success)
                    return Fail(result.error);

                resolvedInstanceId = result.instanceId;
                resolvedName = result.name;
                resolvedAssetPath = result.assetPath;
                didInstantiate = true;
            }
            // 1d. Has assetPath + modify fields → modify-only (resolve path, skip instantiation)
            else if (!string.IsNullOrEmpty(assetPath) && hasModifyFields)
            {
                // Just resolve the path — Phase 2 will do the work
                resolvedAssetPath = assetPath;
            }
            // 1e. Has instanceId alone → APPLY overrides
            else if (instanceId != 0)
            {
                var result = ApplyPrefabInstance(instanceId);
                if (!result.success)
                    return Fail(result.error);

                resolvedInstanceId = result.instanceId;
                resolvedName = result.name;
                resolvedAssetPath = result.assetPath;
                didApply = true;
            }
            else
            {
                // Nothing matched — not enough info
                return Fail(
                    "Could not determine prefab operation. Provide: " +
                    "prefabName (instantiate by name), " +
                    "assetPath (instantiate by path or modify), " +
                    "instanceId + savePath (create from GO), " +
                    "or instanceId alone (apply overrides).");
            }

            // =============================================================
            // PHASE 2: Modify prefab asset (if componentType + properties)
            // =============================================================

            int modifySuccessCount = 0;
            int modifyFailCount = 0;
            HierarchyManipulator.PropertyResult[] modifyResults = null;
            string modifyTargetPath = null;
            string modifyComponentType = null;

            if (hasModifyFields && !string.IsNullOrEmpty(resolvedAssetPath))
            {
                var modResult = ModifyPrefab(resolvedAssetPath, componentType, properties, targetPath);

                modifySuccessCount = modResult.successCount;
                modifyFailCount = modResult.failCount;
                modifyResults = modResult.results;
                modifyTargetPath = modResult.targetPath;
                modifyComponentType = modResult.componentType;
                didModify = true;

                if (!modResult.success)
                {
                    // Phase 1 succeeded but Phase 2 failed — report partial success
                    return new UnifiedPrefabResult
                    {
                        success = false,
                        error = modResult.error ?? $"{modifyFailCount} properties failed to set",
                        instanceId = resolvedInstanceId,
                        name = resolvedName,
                        assetPath = resolvedAssetPath,
                        instantiated = didInstantiate,
                        created = didCreate,
                        modified = true, // attempted
                        applied = didApply,
                        targetPath = modifyTargetPath,
                        componentType = modifyComponentType,
                        successCount = modifySuccessCount,
                        failCount = modifyFailCount,
                        propertyResults = modifyResults
                    };
                }
            }

            // =============================================================
            // BUILD RESPONSE
            // =============================================================

            return new UnifiedPrefabResult
            {
                success = true,
                instanceId = resolvedInstanceId,
                name = resolvedName,
                assetPath = resolvedAssetPath,
                instantiated = didInstantiate,
                created = didCreate,
                modified = didModify,
                applied = didApply,
                targetPath = modifyTargetPath,
                componentType = modifyComponentType,
                successCount = modifySuccessCount,
                failCount = modifyFailCount,
                propertyResults = modifyResults
            };
        }
        catch (Exception ex)
        {
            return new UnifiedPrefabResult { success = false, error = ex.Message };
        }
    }

    /// <summary>
    /// Shorthand for returning a failed UnifiedPrefabResult.
    /// </summary>
    private static UnifiedPrefabResult Fail(string error)
    {
        return new UnifiedPrefabResult { success = false, error = error };
    }

    // --- Query Operations ---

    /// <summary>
    /// List all prefabs in the project, optionally filtered by folder or search term.
    /// </summary>
    public static PrefabListResult ListPrefabs(string folder = null, string searchFilter = null, int limit = 100)
    {
        try
        {
            string searchQuery = "t:Prefab";
            if (!string.IsNullOrEmpty(searchFilter))
            {
                searchQuery += " " + searchFilter;
            }

            string[] searchFolders = null;
            if (!string.IsNullOrEmpty(folder))
            {
                // Ensure folder starts with "Assets"
                if (!folder.StartsWith("Assets"))
                {
                    folder = "Assets/" + folder.TrimStart('/');
                }
                if (AssetDatabase.IsValidFolder(folder))
                {
                    searchFolders = new[] { folder };
                }
                else
                {
                    return new PrefabListResult
                    {
                        success = false,
                        error = $"Folder not found: {folder}"
                    };
                }
            }

            string[] guids = searchFolders != null
                ? AssetDatabase.FindAssets(searchQuery, searchFolders)
                : AssetDatabase.FindAssets(searchQuery);

            var prefabs = new List<PrefabInfo>();
            int count = 0;

            foreach (var guid in guids)
            {
                if (count >= limit) break;

                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.EndsWith(".prefab")) continue;

                var asset = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (asset == null) continue;

                bool isVariant = PrefabUtility.IsPartOfVariantPrefab(asset);
                var labels = AssetDatabase.GetLabels(asset);

                prefabs.Add(new PrefabInfo
                {
                    name = asset.name,
                    assetPath = path,
                    guid = guid,
                    isVariant = isVariant,
                    labels = labels
                });

                count++;
            }

            return new PrefabListResult
            {
                success = true,
                count = prefabs.Count,
                prefabs = prefabs.ToArray()
            };
        }
        catch (Exception ex)
        {
            return new PrefabListResult { success = false, error = ex.Message };
        }
    }

    // --- Instantiation Operations ---

    /// <summary>
    /// Instantiate a prefab into the scene, maintaining the prefab link.
    /// </summary>
    public static PrefabResult InstantiatePrefab(string assetPath, int? parentInstanceId = null, 
        float[] position = null, float[] rotation = null, float[] scale = null)
    {
        try
        {
            // Load the prefab asset
            var prefabAsset = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (prefabAsset == null)
            {
                return new PrefabResult
                {
                    success = false,
                    error = $"Prefab not found at path: {assetPath}"
                };
            }

            // Determine parent transform
            Transform parent = null;
            if (parentInstanceId.HasValue)
            {
                var parentGo = EditorUtility.EntityIdToObject(parentInstanceId.Value) as GameObject;
                if (parentGo != null)
                {
                    parent = parentGo.transform;
                }
            }

            // Instantiate as prefab instance (maintains link)
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefabAsset, parent);
            Undo.RegisterCreatedObjectUndo(instance, $"Instantiate Prefab {prefabAsset.name}");

            // Apply transform if specified
            if (position != null && position.Length >= 3)
            {
                instance.transform.localPosition = new Vector3(position[0], position[1], position[2]);
            }
            if (rotation != null && rotation.Length >= 3)
            {
                instance.transform.localRotation = Quaternion.Euler(rotation[0], rotation[1], rotation[2]);
            }
            if (scale != null && scale.Length >= 3)
            {
                instance.transform.localScale = new Vector3(scale[0], scale[1], scale[2]);
            }

            // Record modifications for prefab system
            PrefabUtility.RecordPrefabInstancePropertyModifications(instance.transform);

            Selection.activeGameObject = instance;

            return new PrefabResult
            {
                success = true,
                instanceId = instance.GetInstanceID(),
                name = instance.name,
                assetPath = assetPath
            };
        }
        catch (Exception ex)
        {
            return new PrefabResult { success = false, error = ex.Message };
        }
    }

    /// <summary>
    /// Instantiate a prefab by searching for it by name.
    /// </summary>
    public static PrefabResult InstantiatePrefabByName(string prefabName, int? parentInstanceId = null,
        float[] position = null, float[] rotation = null, float[] scale = null)
    {
        try
        {
            // Search for prefab by name
            string[] guids = AssetDatabase.FindAssets($"t:Prefab {prefabName}");
            
            string foundPath = null;
            foreach (var guid in guids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                string fileName = Path.GetFileNameWithoutExtension(path);
                
                // Exact match preferred
                if (fileName.Equals(prefabName, StringComparison.OrdinalIgnoreCase))
                {
                    foundPath = path;
                    break;
                }
                
                // Otherwise use first partial match
                if (foundPath == null && fileName.IndexOf(prefabName, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    foundPath = path;
                }
            }

            if (foundPath == null)
            {
                return new PrefabResult
                {
                    success = false,
                    error = $"No prefab found matching name: {prefabName}"
                };
            }

            return InstantiatePrefab(foundPath, parentInstanceId, position, rotation, scale);
        }
        catch (Exception ex)
        {
            return new PrefabResult { success = false, error = ex.Message };
        }
    }

    // --- Creation Operations ---

    /// <summary>
    /// Create a new prefab asset from a scene GameObject.
    /// </summary>
    public static PrefabResult CreatePrefabFromGameObject(int instanceId, string savePath = null)
    {
        try
        {
            var go = EditorUtility.EntityIdToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new PrefabResult { success = false, error = "GameObject not found" };
            }

            // Determine save path
            if (string.IsNullOrEmpty(savePath))
            {
                // Default to Assets/Prefabs folder
                string prefabFolder = "Assets/Prefabs";
                if (!AssetDatabase.IsValidFolder(prefabFolder))
                {
                    AssetDatabase.CreateFolder("Assets", "Prefabs");
                }
                savePath = $"{prefabFolder}/{go.name}.prefab";
            }

            // Ensure path ends with .prefab
            if (!savePath.EndsWith(".prefab"))
            {
                savePath += ".prefab";
            }

            // Ensure path starts with Assets
            if (!savePath.StartsWith("Assets"))
            {
                savePath = "Assets/" + savePath.TrimStart('/');
            }

            // Ensure directory exists
            string directory = Path.GetDirectoryName(savePath)?.Replace('\\', '/');
            if (string.IsNullOrEmpty(directory))
            {
                return new PrefabResult { success = false, error = $"Invalid save path: {savePath}" };
            }
            if (!AssetDatabase.IsValidFolder(directory))
            {
                // Create nested directories
                string[] parts = directory.Split('/');
                string currentPath = parts[0];
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

            // Generate unique path if file exists
            savePath = AssetDatabase.GenerateUniqueAssetPath(savePath);

            // Create the prefab and connect the scene instance to it
            bool success;
            var prefab = PrefabUtility.SaveAsPrefabAssetAndConnect(go, savePath, InteractionMode.UserAction, out success);

            if (!success || prefab == null)
            {
                return new PrefabResult
                {
                    success = false,
                    error = "Failed to create prefab asset"
                };
            }

            return new PrefabResult
            {
                success = true,
                instanceId = go.GetInstanceID(),
                name = prefab.name,
                assetPath = savePath
            };
        }
        catch (Exception ex)
        {
            return new PrefabResult { success = false, error = ex.Message };
        }
    }

    /// <summary>
    /// Create a prefab variant from an existing prefab.
    /// </summary>
    public static PrefabResult CreatePrefabVariant(string sourcePrefabPath, string variantPath = null)
    {
        try
        {
            var sourcePrefab = AssetDatabase.LoadAssetAtPath<GameObject>(sourcePrefabPath);
            if (sourcePrefab == null)
            {
                return new PrefabResult
                {
                    success = false,
                    error = $"Source prefab not found: {sourcePrefabPath}"
                };
            }

            // Determine variant path
            if (string.IsNullOrEmpty(variantPath))
            {
                string directory = Path.GetDirectoryName(sourcePrefabPath)?.Replace('\\', '/');
                string baseName = Path.GetFileNameWithoutExtension(sourcePrefabPath);
                variantPath = $"{directory}/{baseName}_Variant.prefab";
            }

            if (!variantPath.EndsWith(".prefab"))
            {
                variantPath += ".prefab";
            }

            if (!variantPath.StartsWith("Assets"))
            {
                variantPath = "Assets/" + variantPath.TrimStart('/');
            }

            variantPath = AssetDatabase.GenerateUniqueAssetPath(variantPath);

            // Instantiate temporarily to create variant
            var tempInstance = (GameObject)PrefabUtility.InstantiatePrefab(sourcePrefab);
            
            try
            {
                // Save as variant
                var variant = PrefabUtility.SaveAsPrefabAsset(tempInstance, variantPath);
                
                if (variant == null)
                {
                    return new PrefabResult
                    {
                        success = false,
                        error = "Failed to create prefab variant"
                    };
                }

                return new PrefabResult
                {
                    success = true,
                    instanceId = variant.GetInstanceID(),
                    name = variant.name,
                    assetPath = variantPath
                };
            }
            finally
            {
                // Clean up temp instance
                UnityEngine.Object.DestroyImmediate(tempInstance);
            }
        }
        catch (Exception ex)
        {
            return new PrefabResult { success = false, error = ex.Message };
        }
    }

    // --- Modification Operations ---

    /// <summary>
    /// Apply all overrides from a prefab instance to the prefab asset.
    /// </summary>
    public static PrefabResult ApplyPrefabInstance(int instanceId)
    {
        try
        {
            var go = EditorUtility.EntityIdToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new PrefabResult { success = false, error = "GameObject not found" };
            }

            if (!PrefabUtility.IsPartOfPrefabInstance(go))
            {
                return new PrefabResult { success = false, error = "GameObject is not a prefab instance" };
            }

            var prefabRoot = PrefabUtility.GetNearestPrefabInstanceRoot(go);
            var prefabAsset = PrefabUtility.GetCorrespondingObjectFromSource(prefabRoot);
            string assetPath = AssetDatabase.GetAssetPath(prefabAsset);

            PrefabUtility.ApplyPrefabInstance(prefabRoot, InteractionMode.UserAction);

            return new PrefabResult
            {
                success = true,
                instanceId = instanceId,
                name = go.name,
                assetPath = assetPath
            };
        }
        catch (Exception ex)
        {
            return new PrefabResult { success = false, error = ex.Message };
        }
    }

    /// <summary>
    /// Revert all overrides on a prefab instance back to the prefab asset values.
    /// </summary>
    public static PrefabResult RevertPrefabInstance(int instanceId)
    {
        try
        {
            var go = EditorUtility.EntityIdToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new PrefabResult { success = false, error = "GameObject not found" };
            }

            if (!PrefabUtility.IsPartOfPrefabInstance(go))
            {
                return new PrefabResult { success = false, error = "GameObject is not a prefab instance" };
            }

            var prefabRoot = PrefabUtility.GetNearestPrefabInstanceRoot(go);
            var prefabAsset = PrefabUtility.GetCorrespondingObjectFromSource(prefabRoot);
            string assetPath = AssetDatabase.GetAssetPath(prefabAsset);

            PrefabUtility.RevertPrefabInstance(prefabRoot, InteractionMode.UserAction);

            return new PrefabResult
            {
                success = true,
                instanceId = instanceId,
                name = go.name,
                assetPath = assetPath
            };
        }
        catch (Exception ex)
        {
            return new PrefabResult { success = false, error = ex.Message };
        }
    }

    /// <summary>
    /// Unpack a prefab instance, breaking the prefab link.
    /// </summary>
    public static PrefabResult UnpackPrefab(int instanceId, bool completely = false)
    {
        try
        {
            var go = EditorUtility.EntityIdToObject(instanceId) as GameObject;
            if (go == null)
            {
                return new PrefabResult { success = false, error = "GameObject not found" };
            }

            if (!PrefabUtility.IsPartOfPrefabInstance(go))
            {
                return new PrefabResult { success = false, error = "GameObject is not a prefab instance" };
            }

            var prefabRoot = PrefabUtility.GetNearestPrefabInstanceRoot(go);
            
            var mode = completely 
                ? PrefabUnpackMode.Completely 
                : PrefabUnpackMode.OutermostRoot;

            PrefabUtility.UnpackPrefabInstance(prefabRoot, mode, InteractionMode.UserAction);

            return new PrefabResult
            {
                success = true,
                instanceId = instanceId,
                name = go.name
            };
        }
        catch (Exception ex)
        {
            return new PrefabResult { success = false, error = ex.Message };
        }
    }

    /// <summary>
    /// Edit a prefab asset directly (opens prefab contents, applies changes, closes).
    /// This allows modifying the prefab asset without going through a scene instance.
    /// </summary>
    public static PrefabResult EditPrefabAsset(string assetPath, Action<GameObject> editAction)
    {
        try
        {
            if (!File.Exists(assetPath) && !assetPath.StartsWith("Assets"))
            {
                assetPath = "Assets/" + assetPath.TrimStart('/');
            }

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (prefab == null)
            {
                return new PrefabResult
                {
                    success = false,
                    error = $"Prefab not found: {assetPath}"
                };
            }

            // Load prefab contents into isolated scene
            var contentsRoot = PrefabUtility.LoadPrefabContents(assetPath);

            try
            {
                // Apply the edit action
                editAction(contentsRoot);

                // Save changes back to prefab
                PrefabUtility.SaveAsPrefabAsset(contentsRoot, assetPath);
            }
            finally
            {
                // Always unload the prefab contents
                PrefabUtility.UnloadPrefabContents(contentsRoot);
            }

            return new PrefabResult
            {
                success = true,
                instanceId = prefab.GetInstanceID(),
                name = prefab.name,
                assetPath = assetPath
            };
        }
        catch (Exception ex)
        {
            return new PrefabResult { success = false, error = ex.Message };
        }
    }

    /// <summary>
    /// Add a component to a prefab asset.
    /// </summary>
    public static PrefabResult AddComponentToPrefab(string assetPath, string componentType)
    {
        return EditPrefabAsset(assetPath, (root) =>
        {
            Type type = FindComponentType(componentType);
            if (type != null)
            {
                root.AddComponent(type);
            }
        });
    }

    /// <summary>
    /// Open prefab in Prefab Mode for editing (user will see it in editor).
    /// </summary>
    public static PrefabResult OpenPrefabForEditing(string assetPath)
    {
        try
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (prefab == null)
            {
                return new PrefabResult
                {
                    success = false,
                    error = $"Prefab not found: {assetPath}"
                };
            }

            // Open in prefab stage
            AssetDatabase.OpenAsset(prefab);

            return new PrefabResult
            {
                success = true,
                instanceId = prefab.GetInstanceID(),
                name = prefab.name,
                assetPath = assetPath
            };
        }
        catch (Exception ex)
        {
            return new PrefabResult { success = false, error = ex.Message };
        }
    }

    /// <summary>
    /// Modify component properties directly on a prefab asset.
    /// </summary>
    /// <param name="assetPath">Path to prefab asset</param>
    /// <param name="componentType">Component type name (e.g., "Rigidbody")</param>
    /// <param name="properties">Property modifications</param>
    /// <param name="targetPath">Optional child path (e.g., "Child/Grandchild"). Null for root.</param>
    public static ModifyPrefabResult ModifyPrefab(string assetPath, string componentType,
        Dictionary<string, JToken> properties, string targetPath = null)
    {
        try
        {
            if (!assetPath.StartsWith("Assets"))
                assetPath = "Assets/" + assetPath.TrimStart('/');

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (prefab == null)
            {
                return new ModifyPrefabResult { success = false, error = $"Prefab not found: {assetPath}" };
            }

            // Load prefab contents
            var root = PrefabUtility.LoadPrefabContents(assetPath);

            try
            {
                // Find target GameObject
                GameObject target = root;
                if (!string.IsNullOrEmpty(targetPath))
                {
                    var targetTransform = root.transform.Find(targetPath);
                    if (targetTransform == null)
                    {
                        return new ModifyPrefabResult
                        {
                            success = false,
                            error = $"Child not found: {targetPath}"
                        };
                    }
                    target = targetTransform.gameObject;
                }

                // Find component
                Component component = null;
                foreach (var comp in target.GetComponents<Component>())
                {
                    if (comp != null && comp.GetType().Name.Equals(componentType, StringComparison.OrdinalIgnoreCase))
                    {
                        component = comp;
                        break;
                    }
                }

                if (component == null)
                {
                    return new ModifyPrefabResult
                    {
                        success = false,
                        error = $"Component '{componentType}' not found on {target.name}"
                    };
                }

                // Use SerializedObject to modify
                var so = new SerializedObject(component);
                var results = new List<HierarchyManipulator.PropertyResult>();
                int successCount = 0;
                int failCount = 0;

                foreach (var kvp in properties)
                {
                    var prop = so.FindProperty(kvp.Key);
                    if (prop == null)
                    {
                        results.Add(new HierarchyManipulator.PropertyResult
                        {
                            success = false,
                            error = $"Property not found: {kvp.Key}",
                            propertyPath = kvp.Key
                        });
                        failCount++;
                        continue;
                    }

                    string error = HierarchyManipulator.SetPropertyValue(prop, kvp.Value);
                    if (error != null)
                    {
                        results.Add(new HierarchyManipulator.PropertyResult
                        {
                            success = false,
                            error = error,
                            propertyPath = kvp.Key
                        });
                        failCount++;
                    }
                    else
                    {
                        results.Add(new HierarchyManipulator.PropertyResult
                        {
                            success = true,
                            propertyPath = kvp.Key,
                            propertyType = prop.propertyType.ToString()
                        });
                        successCount++;
                    }
                }

                so.ApplyModifiedPropertiesWithoutUndo();

                // Save changes
                PrefabUtility.SaveAsPrefabAsset(root, assetPath);

                return new ModifyPrefabResult
                {
                    success = failCount == 0,
                    assetPath = assetPath,
                    targetPath = targetPath,
                    componentType = componentType,
                    successCount = successCount,
                    failCount = failCount,
                    results = results.ToArray()
                };
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }
        catch (Exception ex)
        {
            return new ModifyPrefabResult { success = false, error = ex.Message };
        }
    }

    // --- Helper Methods ---

    private static Type FindComponentType(string typeName)
    {
        // Try Unity's TypeCache first
        var types = TypeCache.GetTypesDerivedFrom<Component>();
        
        // Exact match
        var type = types.FirstOrDefault(t => t.Name == typeName);
        if (type != null) return type;

        // Case-insensitive match
        type = types.FirstOrDefault(t => t.Name.Equals(typeName, StringComparison.OrdinalIgnoreCase));
        if (type != null) return type;

        // Full name match
        type = types.FirstOrDefault(t => t.FullName == typeName);
        if (type != null) return type;

        // Try direct type lookup
        type = Type.GetType(typeName);
        if (type != null && typeof(Component).IsAssignableFrom(type)) return type;

        // Try common assemblies
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            type = assembly.GetType(typeName);
            if (type != null && typeof(Component).IsAssignableFrom(type)) return type;
        }

        return null;
    }
}
#endif