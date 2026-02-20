#if UNITY_EDITOR
using UnityEngine;
using UnityEngine.ProBuilder;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

// Resolve ambiguities between ProBuilder and System/UnityEditor namespaces
using Math = UnityEngine.ProBuilder.Math;

/// <summary>
/// Face selection system for ProBuilderManager.
///
/// Three methods to select faces on a ProBuilderMesh:
///   1. "all"       — Select every face (default when faceSelection is omitted)
///   2. Direction    — Dot product of face normal vs a direction vector.
///                    Shorthand: "up", "down", "left", "right", "forward", "back"
///                    Full form: {method:"direction", direction:"up"|[x,y,z], threshold:0.7}
///                    Default threshold 0.7 (~45 degrees cone)
///   3. Index        — {method:"index", indices:[0,1,5]} for explicit face indices
///
/// Shorthand strings are also accepted: "up" is equivalent to {method:"direction", direction:"up"}.
/// </summary>
public static partial class ProBuilderManager
{
    /// <summary>
    /// Select faces on a ProBuilderMesh based on the faceSelection specification.
    /// Returns (selectedFaces, error). Error is null on success.
    /// </summary>
    internal static (List<Face> faces, string error) SelectFaces(
        ProBuilderMesh mesh, JToken faceSelectionToken)
    {
        // Default: all faces when no selection specified
        if (faceSelectionToken == null)
            return (mesh.faces.ToList(), null);

        // Shorthand: plain string → direction or "all"
        if (faceSelectionToken.Type == JTokenType.String)
        {
            string dirStr = faceSelectionToken.ToString();
            if (dirStr.Equals("all", System.StringComparison.OrdinalIgnoreCase))
                return (mesh.faces.ToList(), null);
            var dir = ParseDirection(dirStr);
            if (!dir.HasValue)
                return (null, $"Invalid direction: '{dirStr}'. Valid: up, down, left, right, forward, back");
            return SelectByDirection(mesh, dir.Value, 0.7f);
        }

        var sel = faceSelectionToken as JObject;
        if (sel == null)
            return (null, "faceSelection must be a string (e.g. \"up\") or object with method/direction/indices");

        string method = sel?["method"]?.ToString()?.ToLowerInvariant() ?? "all";

        switch (method)
        {
            case "all":
                return (mesh.faces.ToList(), null);

            case "direction":
            {
                float threshold = sel?["threshold"]?.ToObject<float>() ?? 0.7f;
                var dirToken = sel?["direction"];

                if (dirToken == null)
                    return (null, "direction is required when method is 'direction'");

                Vector3? dir = null;

                // Try named direction first
                if (dirToken.Type == JTokenType.String)
                {
                    dir = ParseDirection(dirToken.ToString());
                    if (!dir.HasValue)
                        return (null, $"Invalid direction: '{dirToken}'. Valid: up, down, left, right, forward, back");
                }
                // Try [x,y,z] array for custom directions
                else if (dirToken.Type == JTokenType.Array)
                {
                    var dirArr = dirToken.ToObject<float[]>();
                    if (dirArr != null && dirArr.Length >= 3)
                        dir = new Vector3(dirArr[0], dirArr[1], dirArr[2]).normalized;
                }

                if (!dir.HasValue)
                    return (null, $"Could not parse direction: '{dirToken}'");

                return SelectByDirection(mesh, dir.Value, threshold);
            }

            case "index":
            case "indices":
            {
                var indices = sel?["indices"]?.ToObject<int[]>();
                if (indices == null || indices.Length == 0)
                    return (null, "indices array is required when method is 'index'");

                var selectedFaces = new List<Face>();
                var allFaces = mesh.faces;
                foreach (int idx in indices)
                {
                    if (idx < 0 || idx >= allFaces.Count)
                        return (null, $"Face index {idx} out of range (0..{allFaces.Count - 1})");
                    selectedFaces.Add(allFaces[idx]);
                }
                return (selectedFaces, null);
            }

            default:
                return (null, $"Unknown face selection method: '{method}'. Valid: all, direction, index");
        }
    }

    private static (List<Face> faces, string error) SelectByDirection(
        ProBuilderMesh mesh, Vector3 direction, float threshold)
    {
        var selected = new List<Face>();
        var faces = mesh.faces;

        for (int i = 0; i < faces.Count; i++)
        {
            Vector3 faceNormal = Math.Normal(mesh, faces[i]);
            float dot = Vector3.Dot(faceNormal.normalized, direction.normalized);
            if (dot >= threshold)
                selected.Add(faces[i]);
        }

        if (selected.Count == 0)
            return (null, $"No faces found matching direction " +
                         $"({direction.x:F2}, {direction.y:F2}, {direction.z:F2}) with threshold {threshold}");

        return (selected, null);
    }

    private static Vector3? ParseDirection(string dirStr)
    {
        switch (dirStr.ToLowerInvariant().Replace("_", ""))
        {
            case "up":       return Vector3.up;
            case "down":     return Vector3.down;
            case "left":     return Vector3.left;
            case "right":    return Vector3.right;
            case "forward":
            case "front":    return Vector3.forward;
            case "back":
            case "backward": return Vector3.back;
            default:         return null;
        }
    }
}
#endif
