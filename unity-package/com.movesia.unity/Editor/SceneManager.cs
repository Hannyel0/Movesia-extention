#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
using System;
using System.IO;

/// <summary>
/// Provides Scene management operations for the AI agent.
/// </summary>
public static class SceneManagement
{
    // --- Data Structures ---

    [Serializable]
    public class SceneResult
    {
        public bool success;
        public string error;
        public string sceneName;
        public string scenePath;
        public bool isLoaded;
        public bool isDirty;
        public bool isActive;
    }

    // --- Create Scene ---

    /// <summary>
    /// Create a new scene, optionally saving it to disk immediately.
    /// </summary>
    /// <param name="savePath">Optional path to save (e.g., "Assets/Scenes/Level1.unity"). If provided, saves immediately.</param>
    /// <param name="additive">If true, adds to existing scenes. If false, replaces current scene.</param>
    /// <param name="setupMode">Scene setup: "empty" (default), "default" (with camera/light)</param>
    public static SceneResult CreateScene(string savePath = null, bool additive = false, string setupMode = "empty")
    {
        try
        {
            // Determine setup mode
            NewSceneSetup setup = setupMode?.ToLowerInvariant() switch
            {
                "default" => NewSceneSetup.DefaultGameObjects,
                _ => NewSceneSetup.EmptyScene
            };

            var mode = additive ? NewSceneMode.Additive : NewSceneMode.Single;
            var scene = EditorSceneManager.NewScene(setup, mode);

            // If savePath provided, save immediately
            if (!string.IsNullOrEmpty(savePath))
            {
                // Normalize path
                if (!savePath.StartsWith("Assets"))
                    savePath = "Assets/" + savePath.TrimStart('/');

                if (!savePath.EndsWith(".unity"))
                    savePath += ".unity";

                // Ensure directory exists
                string directory = Path.GetDirectoryName(savePath);
                if (!string.IsNullOrEmpty(directory) && !AssetDatabase.IsValidFolder(directory))
                {
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

                // Save the scene
                bool saved = EditorSceneManager.SaveScene(scene, savePath);
                if (!saved)
                {
                    return new SceneResult
                    {
                        success = false,
                        error = $"Scene created but failed to save to: {savePath}",
                        sceneName = scene.name,
                        isLoaded = scene.isLoaded,
                        isDirty = scene.isDirty
                    };
                }

                // Refresh to get updated scene info
                scene = UnityEngine.SceneManagement.SceneManager.GetSceneByPath(savePath);
            }

            return new SceneResult
            {
                success = true,
                sceneName = scene.name,
                scenePath = scene.path,
                isLoaded = scene.isLoaded,
                isDirty = scene.isDirty,
                isActive = scene == UnityEngine.SceneManagement.SceneManager.GetActiveScene()
            };
        }
        catch (Exception ex)
        {
            return new SceneResult { success = false, error = ex.Message };
        }
    }

    // --- Open Scene ---

    /// <summary>
    /// Open an existing scene from disk.
    /// </summary>
    /// <param name="scenePath">Path to scene file (e.g., "Assets/Scenes/Level1.unity")</param>
    /// <param name="additive">If true, adds to existing scenes. If false, replaces current scene.</param>
    public static SceneResult OpenScene(string scenePath, bool additive = false)
    {
        try
        {
            if (!scenePath.StartsWith("Assets"))
                scenePath = "Assets/" + scenePath.TrimStart('/');

            if (!scenePath.EndsWith(".unity"))
                scenePath += ".unity";

            if (!File.Exists(scenePath))
            {
                return new SceneResult { success = false, error = $"Scene not found: {scenePath}" };
            }

            var mode = additive ? OpenSceneMode.Additive : OpenSceneMode.Single;
            var scene = EditorSceneManager.OpenScene(scenePath, mode);

            if (!scene.IsValid())
            {
                return new SceneResult { success = false, error = $"Failed to open scene: {scenePath}" };
            }

            return new SceneResult
            {
                success = true,
                sceneName = scene.name,
                scenePath = scene.path,
                isLoaded = scene.isLoaded,
                isDirty = scene.isDirty,
                isActive = scene == UnityEngine.SceneManagement.SceneManager.GetActiveScene()
            };
        }
        catch (Exception ex)
        {
            return new SceneResult { success = false, error = ex.Message };
        }
    }

    // --- Save Scene ---

    /// <summary>
    /// Save a scene to disk.
    /// </summary>
    /// <param name="sceneName">Name of loaded scene to save (null for active scene)</param>
    /// <param name="savePath">Path to save to (null to save to current path)</param>
    public static SceneResult SaveScene(string sceneName = null, string savePath = null)
    {
        try
        {
            Scene scene;

            if (string.IsNullOrEmpty(sceneName))
            {
                scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            }
            else
            {
                scene = UnityEngine.SceneManagement.SceneManager.GetSceneByName(sceneName);
                if (!scene.IsValid())
                {
                    // Try by path
                    scene = UnityEngine.SceneManagement.SceneManager.GetSceneByPath(sceneName);
                }
            }

            if (!scene.IsValid())
            {
                return new SceneResult { success = false, error = $"Scene not found: {sceneName ?? "active scene"}" };
            }

            // Determine save path
            string path = savePath;
            if (string.IsNullOrEmpty(path))
            {
                path = scene.path;
            }

            if (string.IsNullOrEmpty(path))
            {
                // Scene has never been saved, need a path
                return new SceneResult { success = false, error = "Scene has no path. Provide savePath parameter." };
            }

            if (!path.StartsWith("Assets"))
                path = "Assets/" + path.TrimStart('/');

            if (!path.EndsWith(".unity"))
                path += ".unity";

            // Ensure directory exists
            string directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory) && !AssetDatabase.IsValidFolder(directory))
            {
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

            bool saved = EditorSceneManager.SaveScene(scene, path);

            if (!saved)
            {
                return new SceneResult { success = false, error = "Failed to save scene" };
            }

            return new SceneResult
            {
                success = true,
                sceneName = scene.name,
                scenePath = path,
                isLoaded = scene.isLoaded,
                isDirty = scene.isDirty,
                isActive = scene == UnityEngine.SceneManagement.SceneManager.GetActiveScene()
            };
        }
        catch (Exception ex)
        {
            return new SceneResult { success = false, error = ex.Message };
        }
    }

    // --- Set Active Scene ---

    /// <summary>
    /// Set which scene new GameObjects are created in.
    /// </summary>
    /// <param name="sceneName">Scene name or path</param>
    public static SceneResult SetActiveScene(string sceneName)
    {
        try
        {
            Scene scene = UnityEngine.SceneManagement.SceneManager.GetSceneByName(sceneName);
            
            if (!scene.IsValid())
            {
                scene = UnityEngine.SceneManagement.SceneManager.GetSceneByPath(sceneName);
            }

            if (!scene.IsValid())
            {
                // Try with .unity extension
                if (!sceneName.EndsWith(".unity"))
                {
                    scene = UnityEngine.SceneManagement.SceneManager.GetSceneByPath(sceneName + ".unity");
                }
            }

            if (!scene.IsValid())
            {
                return new SceneResult { success = false, error = $"Scene not found or not loaded: {sceneName}" };
            }

            if (!scene.isLoaded)
            {
                return new SceneResult { success = false, error = $"Scene is not loaded: {sceneName}" };
            }

            bool result = UnityEngine.SceneManagement.SceneManager.SetActiveScene(scene);

            if (!result)
            {
                return new SceneResult { success = false, error = "Failed to set active scene" };
            }

            return new SceneResult
            {
                success = true,
                sceneName = scene.name,
                scenePath = scene.path,
                isLoaded = scene.isLoaded,
                isDirty = scene.isDirty,
                isActive = true
            };
        }
        catch (Exception ex)
        {
            return new SceneResult { success = false, error = ex.Message };
        }
    }
}
#endif