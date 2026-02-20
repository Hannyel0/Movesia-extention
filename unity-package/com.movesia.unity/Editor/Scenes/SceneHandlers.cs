#if UNITY_EDITOR
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

/// <summary>
/// Handles scene operations: create_scene, open_scene, save_scene, set_active_scene.
/// </summary>
internal static class SceneHandlers
{
    internal static async Task HandleCreateScene(string requestId, JToken body)
    {
        string savePath = body?["savePath"]?.ToString();
        bool additive = body?["additive"]?.ToObject<bool>() ?? false;
        string setupMode = body?["setupMode"]?.ToString() ?? "empty";

        var result = SceneManagement.CreateScene(savePath, additive, setupMode);
        await MessageRouter.SendResponse(requestId, "scene_created", result);
    }

    internal static async Task HandleOpenScene(string requestId, JToken body)
    {
        string scenePath = body?["scenePath"]?.ToString();
        bool additive = body?["additive"]?.ToObject<bool>() ?? false;

        if (string.IsNullOrEmpty(scenePath))
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "scenePath is required" });
            return;
        }

        var result = SceneManagement.OpenScene(scenePath, additive);
        await MessageRouter.SendResponse(requestId, "scene_opened", result);
    }

    internal static async Task HandleSaveScene(string requestId, JToken body)
    {
        string sceneName = body?["sceneName"]?.ToString();
        string savePath = body?["savePath"]?.ToString();

        var result = SceneManagement.SaveScene(sceneName, savePath);
        await MessageRouter.SendResponse(requestId, "scene_saved", result);
    }

    internal static async Task HandleSetActiveScene(string requestId, JToken body)
    {
        string sceneName = body?["sceneName"]?.ToString();

        if (string.IsNullOrEmpty(sceneName))
        {
            await MessageRouter.SendResponse(requestId, "error_response", new { error = "sceneName is required" });
            return;
        }

        var result = SceneManagement.SetActiveScene(sceneName);
        await MessageRouter.SendResponse(requestId, "active_scene_set", result);
    }
}
#endif
