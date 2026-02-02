#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using UnityEngine.SceneManagement;
using System;
using System.Collections.Generic;

/// <summary>
/// Captures Unity hierarchy data on-demand.
/// </summary>
public static class HierarchyTracker
{
    // --- Reusable buffer to avoid GC allocation ---
    private static readonly List<GameObject> rootObjectsBuffer = new List<GameObject>(64);
    
    // --- Data Structures ---
    
    [Serializable]
    public class HierarchySnapshot
    {
        public long timestamp;
        public int sceneCount;
        public SceneData[] scenes;
    }
    
    [Serializable]
    public class SceneData
    {
        public string name;
        public string path;
        public int buildIndex;
        public bool isDirty;
        public bool isLoaded;
        public bool isActive;
        public int rootCount;
        public GameObjectData[] rootObjects;
    }
    
    [Serializable]
    public class GameObjectData
    {
        public int instanceId;
        public string name;
        public bool activeSelf;
        public bool activeInHierarchy;
        public string tag;
        public string layer;
        public string[] components;
        public int childCount;
        public bool isPrefabInstance;
        public string prefabAssetPath;  // null if not a prefab instance
        public bool hasPrefabOverrides;
        public GameObjectData[] children;
    }
    
    // --- Public API ---
    
    /// <summary>
    /// Capture full hierarchy snapshot of all loaded scenes.
    /// </summary>
    public static HierarchySnapshot CaptureSnapshot(int maxDepth = 10)
    {
        int sceneCount = SceneManager.sceneCount;
        var scenes = new SceneData[sceneCount];
        
        for (int i = 0; i < sceneCount; i++)
        {
            scenes[i] = CaptureScene(SceneManager.GetSceneAt(i), maxDepth);
        }
        
        return new HierarchySnapshot
        {
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            sceneCount = sceneCount,
            scenes = scenes
        };
    }
    
    /// <summary>
    /// Capture only scene metadata (no GameObjects).
    /// </summary>
    public static SceneData[] CaptureSceneList()
    {
        int sceneCount = SceneManager.sceneCount;
        var scenes = new SceneData[sceneCount];
        var activeScene = SceneManager.GetActiveScene();
        
        for (int i = 0; i < sceneCount; i++)
        {
            var scene = SceneManager.GetSceneAt(i);
            scenes[i] = new SceneData
            {
                name = scene.name,
                path = scene.path,
                buildIndex = scene.buildIndex,
                isDirty = scene.isDirty,
                isLoaded = scene.isLoaded,
                isActive = scene == activeScene,
                rootCount = scene.rootCount,
                rootObjects = null // Not included in list-only
            };
        }
        
        return scenes;
    }
    
    // --- Private Helpers ---
    
    private static SceneData CaptureScene(Scene scene, int maxDepth)
    {
        var activeScene = SceneManager.GetActiveScene();
        
        var sceneData = new SceneData
        {
            name = scene.name,
            path = scene.path,
            buildIndex = scene.buildIndex,
            isDirty = scene.isDirty,
            isLoaded = scene.isLoaded,
            isActive = scene == activeScene,
            rootCount = scene.rootCount
        };
        
        if (scene.isLoaded)
        {
            // Use buffer to avoid allocation
            rootObjectsBuffer.Clear();
            scene.GetRootGameObjects(rootObjectsBuffer);
            
            sceneData.rootObjects = new GameObjectData[rootObjectsBuffer.Count];
            for (int i = 0; i < rootObjectsBuffer.Count; i++)
            {
                sceneData.rootObjects[i] = CaptureGameObject(rootObjectsBuffer[i], maxDepth, 0);
            }
        }
        
        return sceneData;
    }
    
    private static GameObjectData CaptureGameObject(GameObject go, int maxDepth, int currentDepth)
    {
        // Capture components
        var components = go.GetComponents<Component>();
        var componentNames = new string[components.Length];
        for (int i = 0; i < components.Length; i++)
        {
            componentNames[i] = components[i] != null ? components[i].GetType().Name : "Missing";
        }

        // Capture prefab info
        bool isPrefab = PrefabUtility.IsPartOfPrefabInstance(go);
        string prefabPath = null;
        bool hasOverrides = false;

        if (isPrefab)
        {
            var source = PrefabUtility.GetCorrespondingObjectFromSource(go);
            if (source != null)
                prefabPath = AssetDatabase.GetAssetPath(source);
            hasOverrides = PrefabUtility.HasPrefabInstanceAnyOverrides(go, false);
        }

        var data = new GameObjectData
        {
            instanceId = go.GetInstanceID(),
            name = go.name,
            activeSelf = go.activeSelf,
            activeInHierarchy = go.activeInHierarchy,
            tag = go.tag,
            layer = LayerMask.LayerToName(go.layer),
            components = componentNames,
            childCount = go.transform.childCount,
            isPrefabInstance = isPrefab,
            prefabAssetPath = prefabPath,
            hasPrefabOverrides = hasOverrides
        };
        
        // Recursively capture children if within depth limit
        if (currentDepth < maxDepth && go.transform.childCount > 0)
        {
            data.children = new GameObjectData[go.transform.childCount];
            for (int i = 0; i < go.transform.childCount; i++)
            {
                data.children[i] = CaptureGameObject(
                    go.transform.GetChild(i).gameObject,
                    maxDepth,
                    currentDepth + 1
                );
            }
        }
        
        return data;
    }
}
#endif