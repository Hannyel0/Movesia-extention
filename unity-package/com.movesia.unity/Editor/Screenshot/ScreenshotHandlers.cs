#if UNITY_EDITOR
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

/// <summary>
/// Handles capture_screenshot messages.
/// </summary>
internal static class ScreenshotHandlers
{
    private static readonly Dictionary<string, string> ScreenshotCanonicalMap =
        new Dictionary<string, string>
    {
        { "source",        "source" },
        { "view",          "source" },
        { "window",        "source" },
        { "viewtype",      "source" },
        { "target",        "source" },
        { "capturesource", "source" },
    };

    internal static async Task HandleCaptureScreenshot(string requestId, JToken body)
    {
        var b = MessageRouter.NormalizeKeys(body, ScreenshotCanonicalMap);
        string source = b?["source"]?.ToString() ?? "sceneView";

        var result = ScreenshotManager.CaptureScreenshot(source);
        await MessageRouter.SendResponse(requestId, "screenshot_result", result);
    }
}
#endif
