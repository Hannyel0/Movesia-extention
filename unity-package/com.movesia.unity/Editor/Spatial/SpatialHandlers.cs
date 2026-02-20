#if UNITY_EDITOR
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

/// <summary>
/// Handles get_spatial_context messages.
/// Returns all renderable objects in the scene with spatial data and alignment checks.
/// </summary>
internal static class SpatialHandlers
{
    // --- Fuzzy key canonical map ---
    // Maps LLM hallucinations like "max_distance", "MaxDistance", "include_inactive" etc.
    // to canonical camelCase field names. NormalizeKeys strips underscores + lowercases before lookup.
    private static readonly Dictionary<string, string> SpatialContextCanonicalMap =
        new Dictionary<string, string>
    {
        // maxDistance
        { "maxdistance",            "maxDistance" },
        { "distance",               "maxDistance" },
        { "tolerance",              "maxDistance" },
        { "nearbydistance",         "maxDistance" },
        { "nearbythreshold",        "maxDistance" },
        { "proximityrange",         "maxDistance" },
        { "range",                  "maxDistance" },

        // maxObjects
        { "maxobjects",             "maxObjects" },
        { "limit",                  "maxObjects" },
        { "maxcount",               "maxObjects" },
        { "objectlimit",            "maxObjects" },
        { "maxresults",             "maxObjects" },

        // minBoundsSize
        { "minboundssize",          "minBoundsSize" },
        { "minsize",                "minBoundsSize" },
        { "minimumsize",            "minBoundsSize" },
        { "minbounds",              "minBoundsSize" },
        { "boundsthreshold",        "minBoundsSize" },

        // includeInactive
        { "includeinactive",        "includeInactive" },
        { "inactive",               "includeInactive" },
        { "showinactive",           "includeInactive" },
        { "withinactive",           "includeInactive" },

        // includeAlignmentChecks
        { "includealignmentchecks", "includeAlignmentChecks" },
        { "alignmentchecks",        "includeAlignmentChecks" },
        { "alignment",              "includeAlignmentChecks" },
        { "checkalignment",         "includeAlignmentChecks" },
        { "withalignment",          "includeAlignmentChecks" },
        { "checks",                 "includeAlignmentChecks" },

        // includeComponents
        { "includecomponents",      "includeComponents" },
        { "components",             "includeComponents" },
        { "showcomponents",         "includeComponents" },
        { "withcomponents",         "includeComponents" },

        // skipDefaultLayers
        { "skipdefaultlayers",      "skipDefaultLayers" },
        { "skiplayers",             "skipDefaultLayers" },
        { "filterlayers",           "skipDefaultLayers" },
        { "defaultlayers",          "skipDefaultLayers" },

        // namePattern
        { "namepattern",            "namePattern" },
        { "name",                   "namePattern" },
        { "filter",                 "namePattern" },
        { "namefilter",             "namePattern" },
        { "search",                 "namePattern" },
        { "pattern",                "namePattern" },

        // tagFilter
        { "tagfilter",              "tagFilter" },
        { "tag",                    "tagFilter" },
        { "filtertag",              "tagFilter" },

        // instanceIds (focused mode)
        { "instanceids",            "instanceIds" },
        { "ids",                    "instanceIds" },
        { "focusobjects",           "instanceIds" },
        { "targets",                "instanceIds" },
        { "targetids",              "instanceIds" },
        { "gameobjectids",          "instanceIds" },

        // names (focused mode — find by GameObject name)
        { "names",                  "names" },
        { "objectnames",            "names" },
        { "gameobjectnames",        "names" },
        { "objects",                "names" },
        { "focus",                  "names" },
    };

    internal static async Task HandleGetSpatialContext(string requestId, JToken body)
    {
        var b = MessageRouter.NormalizeKeys(body, SpatialContextCanonicalMap);

        // Focused mode: agent passes specific instanceIds and/or names to check
        int[] instanceIds           = b?["instanceIds"]?.ToObject<int[]>();
        string[] names              = b?["names"]?.ToObject<string[]>();
        float maxDistance           = b?["maxDistance"]?.ToObject<float>() ?? 0.5f;
        int maxObjects              = b?["maxObjects"]?.ToObject<int>() ?? 200;
        float minBoundsSize         = b?["minBoundsSize"]?.ToObject<float>() ?? 0.1f;
        bool includeInactive        = b?["includeInactive"]?.ToObject<bool>() ?? false;
        bool includeAlignmentChecks = b?["includeAlignmentChecks"]?.ToObject<bool>() ?? true;
        bool includeComponents      = b?["includeComponents"]?.ToObject<bool>() ?? false;
        bool skipDefaultLayers      = b?["skipDefaultLayers"]?.ToObject<bool>() ?? true;
        string namePattern          = b?["namePattern"]?.ToString();
        string tagFilter            = b?["tagFilter"]?.ToString();

        var result = SpatialContextManager.GatherSpatialContext(
            instanceIds, names, maxDistance, maxObjects, minBoundsSize,
            includeInactive, includeAlignmentChecks, includeComponents,
            skipDefaultLayers, namePattern, tagFilter);

        await MessageRouter.SendResponse(requestId, "spatial_context", result);
    }
}
#endif
