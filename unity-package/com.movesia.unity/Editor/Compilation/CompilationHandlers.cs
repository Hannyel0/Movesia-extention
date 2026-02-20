#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using UnityEditor;
using Newtonsoft.Json.Linq;

/// <summary>
/// Handles compilation/refresh operations: refresh_assets, get_compilation_status, get_available_types.
/// </summary>
internal static class CompilationHandlers
{
    /// <summary>
    /// Triggers asset refresh and script compilation.
    /// This may cause a domain reload - the response will be sent asynchronously
    /// after compilation completes via "compilation_complete" message.
    /// </summary>
    internal static async Task HandleRefreshAssets(string requestId, JToken body)
    {
        var result = await CompilationManager.HandleRefreshRequest(requestId, body);

        // If result is null, domain reload is happening and response will be sent later
        if (result != null)
        {
            await MessageRouter.SendResponse(requestId, "refresh_assets_response", result);
        }
        // If result is null, CompilationManager will send "compilation_complete" after domain reload
    }

    /// <summary>
    /// Gets current compilation status without triggering a refresh.
    /// </summary>
    internal static async Task HandleGetCompilationStatus(string requestId, JToken body)
    {
        var status = CompilationManager.GetCompilationStatus();
        await MessageRouter.SendResponse(requestId, "compilation_status", status);
    }

    /// <summary>
    /// Gets all available component types (MonoBehaviours and built-in Unity components).
    /// </summary>
    internal static async Task HandleGetAvailableTypes(string requestId, JToken body)
    {
        string filter = body?["filter"]?.ToString();
        bool includeBuiltIn = body?["includeBuiltIn"]?.ToObject<bool>() ?? true;

        var types = new List<object>();

        // Get custom MonoBehaviours from Assembly-CSharp
        var customTypes = TypeCache.GetTypesDerivedFrom<MonoBehaviour>()
            .Where(t => !t.IsAbstract && !t.IsGenericType)
            .Where(t => t.Assembly.GetName().Name == "Assembly-CSharp" ||
                       t.Assembly.GetName().Name == "Assembly-CSharp-Editor")
            .Where(t => string.IsNullOrEmpty(filter) ||
                       t.Name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0)
            .Select(t => new {
                name = t.Name,
                fullName = t.FullName,
                isCustom = true,
                assembly = t.Assembly.GetName().Name
            });

        types.AddRange(customTypes);

        // Optionally include common built-in Unity components
        if (includeBuiltIn)
        {
            var builtInTypes = new[]
            {
                "Rigidbody", "Rigidbody2D",
                "BoxCollider", "SphereCollider", "CapsuleCollider", "MeshCollider",
                "BoxCollider2D", "CircleCollider2D", "PolygonCollider2D",
                "AudioSource", "AudioListener",
                "Camera", "Light",
                "MeshRenderer", "MeshFilter", "SkinnedMeshRenderer",
                "SpriteRenderer", "LineRenderer", "TrailRenderer",
                "Canvas", "CanvasRenderer", "CanvasScaler", "GraphicRaycaster",
                "Animator", "Animation",
                "NavMeshAgent", "NavMeshObstacle",
                "CharacterController",
                "ParticleSystem",
                "TextMesh"
            }
            .Where(t => string.IsNullOrEmpty(filter) ||
                       t.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0)
            .Select(t => new {
                name = t,
                fullName = "UnityEngine." + t,
                isCustom = false,
                assembly = "UnityEngine"
            });

            types.AddRange(builtInTypes);
        }

        await MessageRouter.SendResponse(requestId, "available_types", new {
            count = types.Count,
            types = types.OrderBy(t => ((dynamic)t).name).ToList()
        });
    }
}
#endif
