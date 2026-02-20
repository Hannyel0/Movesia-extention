#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// Gathers spatial context for all renderable objects in the current scene(s).
/// Returns world-space positions, bounds, and automatic alignment checks that
/// give an LLM agent "computed vision" — the same spatial insights a human
/// would draw from looking at the scene.
///
/// ProBuilder enrichment is optional: if the ProBuilder sub-assembly is loaded,
/// it registers a callback via ProBuilderEnrichment to populate face/vertex/edge
/// counts on ProBuilder meshes.
/// </summary>
public static class SpatialContextManager
{
    // =========================================================================
    // PROBUILDER ENRICHMENT CALLBACK
    // =========================================================================

    /// <summary>
    /// Delegate that the ProBuilder sub-assembly registers to enrich spatial objects
    /// with ProBuilder-specific data (face count, vertex count, edge count).
    /// </summary>
    public delegate void ProBuilderEnrichmentDelegate(GameObject go, SpatialObjectData data);

    /// <summary>
    /// Registered enrichment callback. Null if ProBuilder is not installed.
    /// </summary>
    public static ProBuilderEnrichmentDelegate ProBuilderEnrichment { get; set; }

    // =========================================================================
    // ROUNDING HELPERS — 1 decimal place cuts token count significantly
    // e.g. 3.1415927 → 3.1  (5 chars saved per float, ~60 floats per object)
    // =========================================================================

    private static float R(float v) => Mathf.Round(v * 10f) / 10f;

    private static float[] RVec3(float x, float y, float z) =>
        new[] { R(x), R(y), R(z) };

    private static bool IsZeroVec3(float[] v) =>
        v[0] == 0f && v[1] == 0f && v[2] == 0f;

    private static bool IsOneVec3(float[] v) =>
        v[0] == 1f && v[1] == 1f && v[2] == 1f;

    // =========================================================================
    // DATA STRUCTURES
    // =========================================================================
    //
    // Token-saving conventions:
    //   - All floats rounded to 1 decimal place
    //   - rotation omitted when [0,0,0] (NullValueHandling.Ignore)
    //   - scale omitted when [1,1,1]
    //   - layer omitted when "Default"
    //   - tag omitted when "Untagged"
    //   - parentInstanceId/parentName omitted when root (0/null)
    //   - isProBuilder omitted when false
    //   - ProBuilder extras omitted when 0
    //   - components omitted unless includeComponents=true
    //   - bounds uses min+size only (center = min + size/2, max = min + size)
    // =========================================================================

    [Serializable]
    public class SpatialContextResult
    {
        public bool success;

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string error;

        public SpatialObjectData[] objects;

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string[] alignmentChecks;

        public int objectCount;
        public int proBuilderCount;
        public bool truncated;
        public string[] sceneNames;
    }

    [Serializable]
    public class SpatialObjectData
    {
        public string name;
        public int instanceId;
        public float[] position;       // world position [x, y, z], rounded 1dp

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public float[] rotation;       // euler angles — null (omitted) when [0,0,0]

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public float[] scale;          // local scale — null (omitted) when [1,1,1]

        public BoundsData bounds;      // world-space renderer bounds (min + size only)

        [JsonProperty(DefaultValueHandling = DefaultValueHandling.Ignore)]
        public bool isProBuilder;

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string[] components;    // null unless includeComponents=true

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string layer;           // null (omitted) when "Default"

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string tag;             // null (omitted) when "Untagged"

        [JsonProperty(DefaultValueHandling = DefaultValueHandling.Ignore)]
        public int parentInstanceId;   // 0 (omitted) if root

        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string parentName;      // null (omitted) if root

        // ProBuilder extras — omitted when 0 (not a ProBuilder mesh)
        [JsonProperty(DefaultValueHandling = DefaultValueHandling.Ignore)]
        public int faceCount;
        [JsonProperty(DefaultValueHandling = DefaultValueHandling.Ignore)]
        public int vertexCount;
        [JsonProperty(DefaultValueHandling = DefaultValueHandling.Ignore)]
        public int edgeCount;
    }

    /// <summary>
    /// Bounds: min, max, size. Center omitted (center = min + size/2).
    /// </summary>
    [Serializable]
    public class BoundsData
    {
        public float[] min;            // [x, y, z]
        public float[] max;            // [x, y, z]
        public float[] size;           // [x, y, z]
    }

    // Layers to skip by default (UI elements, raycast-ignored objects)
    private static readonly HashSet<string> DefaultSkipLayers = new HashSet<string>
    {
        "UI",
        "Ignore Raycast"
    };

    // =========================================================================
    // MAIN ENTRY POINT
    // =========================================================================

    /// <summary>
    /// Gather spatial context for renderable objects in loaded scenes.
    ///
    /// FOCUSED MODE (instanceIds provided):
    ///   Only returns the specified objects + their nearby neighbors (within maxDistance).
    ///   This is the recommended usage — agent passes the instanceIds it just created/modified
    ///   and gets back only the relevant spatial context, not the whole scene.
    ///
    /// FULL SCENE MODE (instanceIds null/empty):
    ///   Returns all renderable objects in the scene (capped by maxObjects).
    ///   Use sparingly — can bloat context on large scenes.
    /// </summary>
    public static SpatialContextResult GatherSpatialContext(
        int[] instanceIds = null,
        string[] names = null,
        float maxDistance = 0.5f,
        int maxObjects = 200,
        float minBoundsSize = 0.1f,
        bool includeInactive = false,
        bool includeAlignmentChecks = true,
        bool includeComponents = false,
        bool skipDefaultLayers = true,
        string namePattern = null,
        string tagFilter = null)
    {
        try
        {
            bool hasIds = instanceIds != null && instanceIds.Length > 0;
            bool hasNames = names != null && names.Length > 0;

            if (hasIds || hasNames)
                return GatherFocused(instanceIds, names, maxDistance, minBoundsSize,
                    includeAlignmentChecks, includeComponents);
            else
                return GatherFullScene(maxDistance, maxObjects, minBoundsSize,
                    includeInactive, includeAlignmentChecks, includeComponents,
                    skipDefaultLayers, namePattern, tagFilter);
        }
        catch (Exception ex)
        {
            return new SpatialContextResult
            {
                success = false,
                error = ex.Message
            };
        }
    }

    // =========================================================================
    // FOCUSED MODE — only the requested objects + their nearby neighbors
    // =========================================================================

    private static SpatialContextResult GatherFocused(
        int[] instanceIds, string[] names, float maxDistance, float minBoundsSize,
        bool includeAlignmentChecks, bool includeComponents)
    {
        var focusObjects = new List<SpatialObjectData>();
        var focusIdSet = new HashSet<int>();
        var sceneNames = new HashSet<string>();
        int proBuilderCount = 0;

        // Step 1a: Look up focus objects by instanceId
        if (instanceIds != null)
        {
            foreach (int id in instanceIds)
            {
                var go = UnityEditor.EditorUtility.InstanceIDToObject(id) as GameObject;
                if (go == null) continue;
                if (focusIdSet.Contains(go.GetInstanceID())) continue;

                AddFocusObject(go, focusObjects, focusIdSet, sceneNames,
                    includeComponents, ref proBuilderCount);
            }
        }

        // Step 1b: Look up focus objects by name
        if (names != null)
        {
            foreach (string name in names)
            {
                if (string.IsNullOrEmpty(name)) continue;

                // GameObject.Find only finds active objects by exact path/name
                var go = GameObject.Find(name);
                if (go != null && !focusIdSet.Contains(go.GetInstanceID()))
                {
                    AddFocusObject(go, focusObjects, focusIdSet, sceneNames,
                        includeComponents, ref proBuilderCount);
                }

                // Also search all loaded scenes for partial/substring matches
                // (handles cases like "Wall" matching "Wall_Left", "Wall_Right")
                int scCount = SceneManager.sceneCount;
                for (int i = 0; i < scCount; i++)
                {
                    var sc = SceneManager.GetSceneAt(i);
                    if (!sc.isLoaded) continue;
                    foreach (var root in sc.GetRootGameObjects())
                    {
                        FindGameObjectsByName(root, name, focusObjects, focusIdSet,
                            sceneNames, includeComponents, ref proBuilderCount);
                    }
                }
            }
        }

        if (focusObjects.Count == 0)
        {
            return new SpatialContextResult
            {
                success = true,
                objects = Array.Empty<SpatialObjectData>(),
                alignmentChecks = Array.Empty<string>(),
                objectCount = 0,
                proBuilderCount = 0,
                truncated = false,
                sceneNames = Array.Empty<string>()
            };
        }

        // Step 2: Scan scene for nearby neighbors of the focus objects
        var allObjects = new List<SpatialObjectData>(focusObjects);

        int sceneCount = SceneManager.sceneCount;
        for (int i = 0; i < sceneCount; i++)
        {
            var scene = SceneManager.GetSceneAt(i);
            if (!scene.isLoaded) continue;

            var rootObjects = scene.GetRootGameObjects();
            foreach (var root in rootObjects)
            {
                FindNearbyNeighbors(root, focusObjects, focusIdSet, maxDistance,
                    includeComponents, allObjects, ref proBuilderCount);
            }
        }

        // Step 3: Alignment checks on the combined set (focus + neighbors)
        string[] alignmentChecks = null;
        if (includeAlignmentChecks && allObjects.Count > 1)
        {
            alignmentChecks = GenerateAlignmentChecks(allObjects, maxDistance, minBoundsSize);
        }

        return new SpatialContextResult
        {
            success = true,
            objects = allObjects.ToArray(),
            alignmentChecks = alignmentChecks ?? Array.Empty<string>(),
            objectCount = allObjects.Count,
            proBuilderCount = proBuilderCount,
            truncated = false,
            sceneNames = sceneNames.ToArray()
        };
    }

    /// <summary>
    /// Add a GameObject as a focus object if it has a valid renderer.
    /// </summary>
    private static void AddFocusObject(
        GameObject go,
        List<SpatialObjectData> focusObjects,
        HashSet<int> focusIdSet,
        HashSet<string> sceneNames,
        bool includeComponents,
        ref int proBuilderCount)
    {
        var renderer = go.GetComponent<Renderer>();
        if (renderer == null || !(renderer is MeshRenderer || renderer is SkinnedMeshRenderer))
            return;

        var data = BuildSpatialObjectData(go, renderer, includeComponents);

        if (ProBuilderEnrichment != null)
        {
            ProBuilderEnrichment(go, data);
            if (data.isProBuilder) proBuilderCount++;
        }

        focusObjects.Add(data);
        focusIdSet.Add(go.GetInstanceID());

        var scene = go.scene;
        if (scene.IsValid()) sceneNames.Add(scene.name);
    }

    /// <summary>
    /// Recursively find GameObjects whose name matches (case-insensitive substring).
    /// Adds them as focus objects if they have a renderer.
    /// </summary>
    private static void FindGameObjectsByName(
        GameObject go, string searchName,
        List<SpatialObjectData> focusObjects,
        HashSet<int> focusIdSet,
        HashSet<string> sceneNames,
        bool includeComponents,
        ref int proBuilderCount)
    {
        if (!focusIdSet.Contains(go.GetInstanceID()) &&
            go.name.IndexOf(searchName, StringComparison.OrdinalIgnoreCase) >= 0)
        {
            AddFocusObject(go, focusObjects, focusIdSet, sceneNames,
                includeComponents, ref proBuilderCount);
        }

        for (int i = 0; i < go.transform.childCount; i++)
        {
            FindGameObjectsByName(go.transform.GetChild(i).gameObject, searchName,
                focusObjects, focusIdSet, sceneNames, includeComponents, ref proBuilderCount);
        }
    }

    /// <summary>
    /// Recursively find renderers that are nearby any of the focus objects.
    /// "Nearby" = bounds within maxDistance of any focus object's bounds.
    /// Skips objects already in focusIdSet (already included).
    /// </summary>
    private static void FindNearbyNeighbors(
        GameObject go,
        List<SpatialObjectData> focusObjects,
        HashSet<int> focusIdSet,
        float maxDistance,
        bool includeComponents,
        List<SpatialObjectData> results,
        ref int proBuilderCount)
    {
        if (!go.activeInHierarchy) return;

        int goId = go.GetInstanceID();
        if (!focusIdSet.Contains(goId))
        {
            var renderer = go.GetComponent<Renderer>();
            if (renderer != null && (renderer is MeshRenderer || renderer is SkinnedMeshRenderer))
            {
                var candidateBounds = renderer.bounds;
                var candidateBoundsData = new BoundsData
                {
                    min = RVec3(candidateBounds.min.x, candidateBounds.min.y, candidateBounds.min.z),
                    max = RVec3(candidateBounds.max.x, candidateBounds.max.y, candidateBounds.max.z),
                    size = RVec3(candidateBounds.size.x, candidateBounds.size.y, candidateBounds.size.z)
                };

                // Check if this object is near ANY focus object
                bool isNearby = false;
                foreach (var focus in focusObjects)
                {
                    if (AreBoundsNearby(focus.bounds, candidateBoundsData, maxDistance))
                    {
                        isNearby = true;
                        break;
                    }
                }

                if (isNearby)
                {
                    var data = BuildSpatialObjectData(go, renderer, includeComponents);
                    if (ProBuilderEnrichment != null)
                    {
                        ProBuilderEnrichment(go, data);
                        if (data.isProBuilder) proBuilderCount++;
                    }
                    results.Add(data);
                    focusIdSet.Add(goId); // prevent duplicates
                }
            }
        }

        // Recurse into children
        for (int i = 0; i < go.transform.childCount; i++)
        {
            FindNearbyNeighbors(go.transform.GetChild(i).gameObject,
                focusObjects, focusIdSet, maxDistance,
                includeComponents, results, ref proBuilderCount);
        }
    }

    // =========================================================================
    // FULL SCENE MODE — all renderers (original behavior, capped by maxObjects)
    // =========================================================================

    private static SpatialContextResult GatherFullScene(
        float maxDistance, int maxObjects, float minBoundsSize,
        bool includeInactive, bool includeAlignmentChecks,
        bool includeComponents, bool skipDefaultLayers,
        string namePattern, string tagFilter)
    {
        var spatialObjects = new List<SpatialObjectData>();
        var sceneNames = new HashSet<string>();
        int proBuilderCount = 0;
        bool truncated = false;

        int sceneCount = SceneManager.sceneCount;
        for (int i = 0; i < sceneCount; i++)
        {
            var scene = SceneManager.GetSceneAt(i);
            if (!scene.isLoaded) continue;

            sceneNames.Add(scene.name);

            var rootObjects = scene.GetRootGameObjects();
            foreach (var root in rootObjects)
            {
                if (truncated) break;
                GatherRenderersRecursive(
                    root, spatialObjects, maxObjects,
                    includeInactive, includeComponents, skipDefaultLayers,
                    namePattern, tagFilter,
                    ref proBuilderCount, ref truncated);
            }
            if (truncated) break;
        }

        // Generate alignment checks between nearby objects
        string[] alignmentChecks = null;
        if (includeAlignmentChecks && spatialObjects.Count > 1)
        {
            alignmentChecks = GenerateAlignmentChecks(spatialObjects, maxDistance, minBoundsSize);
        }

        return new SpatialContextResult
        {
            success = true,
            objects = spatialObjects.ToArray(),
            alignmentChecks = alignmentChecks ?? Array.Empty<string>(),
            objectCount = spatialObjects.Count,
            proBuilderCount = proBuilderCount,
            truncated = truncated,
            sceneNames = sceneNames.ToArray()
        };
    }

    // =========================================================================
    // SCENE TRAVERSAL
    // =========================================================================

    private static void GatherRenderersRecursive(
        GameObject go,
        List<SpatialObjectData> results,
        int maxObjects,
        bool includeInactive,
        bool includeComponents,
        bool skipDefaultLayers,
        string namePattern,
        string tagFilter,
        ref int proBuilderCount,
        ref bool truncated)
    {
        if (truncated) return;
        if (!includeInactive && !go.activeInHierarchy) return;

        // Skip default layers if configured
        if (skipDefaultLayers && DefaultSkipLayers.Contains(LayerMask.LayerToName(go.layer)))
            return;

        // Check for MeshRenderer or SkinnedMeshRenderer
        var renderer = go.GetComponent<Renderer>();
        if (renderer != null && (renderer is MeshRenderer || renderer is SkinnedMeshRenderer))
        {
            // Apply optional filters
            bool passesFilter = true;

            if (!string.IsNullOrEmpty(namePattern))
            {
                passesFilter = go.name.IndexOf(namePattern, StringComparison.OrdinalIgnoreCase) >= 0;
            }

            if (passesFilter && !string.IsNullOrEmpty(tagFilter))
            {
                passesFilter = go.CompareTag(tagFilter);
            }

            if (passesFilter)
            {
                if (results.Count >= maxObjects)
                {
                    truncated = true;
                    return;
                }

                var data = BuildSpatialObjectData(go, renderer, includeComponents);

                // ProBuilder enrichment if callback is registered
                if (ProBuilderEnrichment != null)
                {
                    ProBuilderEnrichment(go, data);
                    if (data.isProBuilder) proBuilderCount++;
                }

                results.Add(data);
            }
        }

        // Recurse into children
        for (int i = 0; i < go.transform.childCount; i++)
        {
            if (truncated) return;
            GatherRenderersRecursive(
                go.transform.GetChild(i).gameObject,
                results, maxObjects,
                includeInactive, includeComponents, skipDefaultLayers,
                namePattern, tagFilter,
                ref proBuilderCount, ref truncated);
        }
    }

    private static SpatialObjectData BuildSpatialObjectData(
        GameObject go, Renderer renderer, bool includeComponents)
    {
        var transform = go.transform;
        var worldBounds = renderer.bounds; // Already in world space

        string[] componentNames = null;
        if (includeComponents)
        {
            var comps = go.GetComponents<Component>();
            componentNames = new string[comps.Length];
            for (int i = 0; i < comps.Length; i++)
            {
                componentNames[i] = comps[i] != null ? comps[i].GetType().Name : "Missing";
            }
        }

        // Round vectors, null-out defaults so JSON serializer omits them
        var rot = RVec3(transform.eulerAngles.x, transform.eulerAngles.y, transform.eulerAngles.z);
        var scl = RVec3(transform.localScale.x, transform.localScale.y, transform.localScale.z);
        string layerName = LayerMask.LayerToName(go.layer);
        string tagName = go.tag;

        return new SpatialObjectData
        {
            name = go.name,
            instanceId = go.GetInstanceID(),
            position = RVec3(transform.position.x, transform.position.y, transform.position.z),
            rotation = IsZeroVec3(rot) ? null : rot,       // omit [0,0,0]
            scale = IsOneVec3(scl) ? null : scl,           // omit [1,1,1]
            bounds = new BoundsData
            {
                min = RVec3(worldBounds.min.x, worldBounds.min.y, worldBounds.min.z),
                max = RVec3(worldBounds.max.x, worldBounds.max.y, worldBounds.max.z),
                size = RVec3(worldBounds.size.x, worldBounds.size.y, worldBounds.size.z)
            },
            isProBuilder = false,
            components = componentNames,
            layer = layerName == "Default" ? null : layerName,      // omit "Default"
            tag = tagName == "Untagged" ? null : tagName,           // omit "Untagged"
            parentInstanceId = transform.parent != null ? transform.parent.gameObject.GetInstanceID() : 0,
            parentName = transform.parent != null ? transform.parent.gameObject.name : null
        };
    }

    // =========================================================================
    // ALIGNMENT CHECKS
    // =========================================================================
    //
    // Center is omitted from BoundsData to save tokens; compute when needed.
    private static float BCenter(BoundsData b, int axis) => b.min[axis] + b.size[axis] / 2f;

    private static string[] GenerateAlignmentChecks(
        List<SpatialObjectData> objects, float maxDistance, float minBoundsSize)
    {
        var checks = new List<string>();

        // Pre-filter: only include objects large enough for meaningful alignment checks
        var candidates = new List<SpatialObjectData>();
        foreach (var obj in objects)
        {
            float sizeMag = Mathf.Sqrt(
                obj.bounds.size[0] * obj.bounds.size[0] +
                obj.bounds.size[1] * obj.bounds.size[1] +
                obj.bounds.size[2] * obj.bounds.size[2]);
            if (sizeMag >= minBoundsSize)
                candidates.Add(obj);
        }

        for (int i = 0; i < candidates.Count; i++)
        {
            for (int j = i + 1; j < candidates.Count; j++)
            {
                var a = candidates[i];
                var b = candidates[j];

                if (!AreBoundsNearby(a.bounds, b.bounds, maxDistance))
                    continue;

                CheckVerticalStacking(a, b, maxDistance, checks);
                CheckHorizontalCentering(a, b, maxDistance, checks);
                CheckFootprintComparison(a, b, checks);
                CheckGapDetection(a, b, maxDistance, checks);
            }
        }

        return checks.ToArray();
    }

    /// <summary>
    /// Check if two axis-aligned bounding boxes are within tolerance distance.
    /// Returns true if they overlap or the gap between them is &lt;= tolerance.
    /// </summary>
    private static bool AreBoundsNearby(BoundsData a, BoundsData b, float tolerance)
    {
        // Per-axis gap: max(0, separation on that axis)
        float gapX = Mathf.Max(0f, Mathf.Max(a.min[0], b.min[0]) - Mathf.Min(a.max[0], b.max[0]));
        float gapY = Mathf.Max(0f, Mathf.Max(a.min[1], b.min[1]) - Mathf.Min(a.max[1], b.max[1]));
        float gapZ = Mathf.Max(0f, Mathf.Max(a.min[2], b.min[2]) - Mathf.Min(a.max[2], b.max[2]));

        float gapDistance = Mathf.Sqrt(gapX * gapX + gapY * gapY + gapZ * gapZ);
        return gapDistance <= tolerance;
    }

    /// <summary>
    /// Check vertical stacking: does the bottom of the upper object match
    /// the top of the lower object?
    /// </summary>
    private static void CheckVerticalStacking(
        SpatialObjectData a, SpatialObjectData b, float tolerance, List<string> checks)
    {
        // Determine upper/lower by center Y
        SpatialObjectData upper, lower;
        if (BCenter(a.bounds, 1) >= BCenter(b.bounds, 1))
        {
            upper = a;
            lower = b;
        }
        else
        {
            upper = b;
            lower = a;
        }

        float upperBottom = upper.bounds.min[1];
        float lowerTop = lower.bounds.max[1];
        float verticalGap = Mathf.Abs(upperBottom - lowerTop);

        if (verticalGap <= tolerance)
        {
            if (verticalGap < 0.01f)
            {
                checks.Add(
                    $"\u2705 {upper.name} bottom ({upperBottom:F1}) matches " +
                    $"{lower.name} top ({lowerTop:F1})");
            }
            else
            {
                checks.Add(
                    $"\u26a0\ufe0f {upper.name} bottom ({upperBottom:F1}) vs " +
                    $"{lower.name} top ({lowerTop:F1}) \u2014 vertical gap of {verticalGap:F2}m");
            }
        }
    }

    /// <summary>
    /// Check horizontal centering: are the centers aligned on X and Z axes?
    /// </summary>
    private static void CheckHorizontalCentering(
        SpatialObjectData a, SpatialObjectData b, float tolerance, List<string> checks)
    {
        float aCx = BCenter(a.bounds, 0);
        float bCx = BCenter(b.bounds, 0);
        float aCz = BCenter(a.bounds, 2);
        float bCz = BCenter(b.bounds, 2);

        float xDiff = Mathf.Abs(aCx - bCx);
        float zDiff = Mathf.Abs(aCz - bCz);

        if (xDiff > tolerance)
        {
            checks.Add(
                $"\u26a0\ufe0f {a.name} center.x ({aCx:F1}) \u2260 " +
                $"{b.name} center.x ({bCx:F1}) \u2014 X misalignment of {xDiff:F1}m");
        }

        if (zDiff > tolerance)
        {
            checks.Add(
                $"\u26a0\ufe0f {a.name} center.z ({aCz:F1}) \u2260 " +
                $"{b.name} center.z ({bCz:F1}) \u2014 Z misalignment of {zDiff:F1}m");
        }
    }

    /// <summary>
    /// Compare footprints (X×Z size) of two nearby objects.
    /// Warns if one is significantly smaller (>10% difference).
    /// </summary>
    private static void CheckFootprintComparison(
        SpatialObjectData a, SpatialObjectData b, List<string> checks)
    {
        float aFootX = a.bounds.size[0];
        float aFootZ = a.bounds.size[2];
        float bFootX = b.bounds.size[0];
        float bFootZ = b.bounds.size[2];

        bool aSmaller = aFootX < bFootX * 0.9f || aFootZ < bFootZ * 0.9f;
        bool bSmaller = bFootX < aFootX * 0.9f || bFootZ < aFootZ * 0.9f;

        if (aSmaller && !bSmaller)
        {
            checks.Add(
                $"\u26a0\ufe0f {a.name} footprint [{aFootX:F1}, {aFootZ:F1}] " +
                $"smaller than {b.name} footprint [{bFootX:F1}, {bFootZ:F1}]");
        }
        else if (bSmaller && !aSmaller)
        {
            checks.Add(
                $"\u26a0\ufe0f {b.name} footprint [{bFootX:F1}, {bFootZ:F1}] " +
                $"smaller than {a.name} footprint [{aFootX:F1}, {aFootZ:F1}]");
        }
    }

    /// <summary>
    /// Detect small unintended gaps between objects at the same vertical level.
    /// Only checks objects that overlap vertically (side-by-side placement).
    /// </summary>
    private static void CheckGapDetection(
        SpatialObjectData a, SpatialObjectData b, float tolerance, List<string> checks)
    {
        // Only check if objects overlap vertically
        float yOverlap = Mathf.Min(a.bounds.max[1], b.bounds.max[1]) -
                         Mathf.Max(a.bounds.min[1], b.bounds.min[1]);
        if (yOverlap <= 0) return;

        float xGap = Mathf.Max(0f,
            Mathf.Max(a.bounds.min[0], b.bounds.min[0]) -
            Mathf.Min(a.bounds.max[0], b.bounds.max[0]));

        float zGap = Mathf.Max(0f,
            Mathf.Max(a.bounds.min[2], b.bounds.min[2]) -
            Mathf.Min(a.bounds.max[2], b.bounds.max[2]));

        if (xGap > 0.01f && xGap <= tolerance)
        {
            checks.Add(
                $"\u26a0\ufe0f Gap of {xGap:F2}m on X between {a.name} and {b.name}");
        }
        if (zGap > 0.01f && zGap <= tolerance)
        {
            checks.Add(
                $"\u26a0\ufe0f Gap of {zGap:F2}m on Z between {a.name} and {b.name}");
        }
    }
}
#endif
