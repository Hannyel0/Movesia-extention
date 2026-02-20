#if UNITY_EDITOR
using System;
using UnityEngine;
using UnityEditor;
using UnityEditorInternal;

/// <summary>
/// Captures editor view screenshots and returns them as base64 JPEG.
/// Hardcoded settings: JPEG quality 70, max dimension 768px.
/// </summary>
public static class ScreenshotManager
{
    private const int JpegQuality = 70;
    private const int MaxDimension = 768;

    [Serializable]
    public class ScreenshotResult
    {
        public bool success;
        public string error;
        public string imageBase64;
        public int width;
        public int height;
        public string source;
        public int byteSize;
    }

    /// <summary>
    /// Capture the Scene View or Game View as a base64 JPEG.
    /// </summary>
    public static ScreenshotResult CaptureScreenshot(string source = "sceneView")
    {
        string normalizedSource = NormalizeSource(source);

        EditorWindow window;
        try
        {
            window = FindWindow(normalizedSource);
        }
        catch (Exception ex)
        {
            return new ScreenshotResult { success = false, error = ex.Message };
        }

        if (window == null)
        {
            string viewName = normalizedSource == "gameView" ? "Game View" : "Scene View";
            return new ScreenshotResult
            {
                success = false,
                error = $"{viewName} is not open"
            };
        }

        // Check for zero-size window (minimized)
        var pos = window.position;
        if (pos.width < 1 || pos.height < 1)
        {
            return new ScreenshotResult
            {
                success = false,
                error = "Target window has zero size (minimized?)"
            };
        }

        try
        {
            return CaptureWindow(window, normalizedSource);
        }
        catch (Exception ex)
        {
            return new ScreenshotResult { success = false, error = ex.Message };
        }
    }

    private static ScreenshotResult CaptureWindow(EditorWindow window, string source)
    {
        var pos = window.position;
        float dpi = EditorGUIUtility.pixelsPerPoint;
        int pixelWidth = Mathf.RoundToInt(pos.width * dpi);
        int pixelHeight = Mathf.RoundToInt(pos.height * dpi);

        // ReadScreenPixel expects screen-space coordinates in physical pixels
        Color[] pixels = InternalEditorUtility.ReadScreenPixel(
            new Vector2(pos.x * dpi, pos.y * dpi),
            pixelWidth,
            pixelHeight
        );

        // Create texture from pixel data
        var texture = new Texture2D(pixelWidth, pixelHeight, TextureFormat.RGB24, false);
        texture.SetPixels(pixels);
        texture.Apply();

        int finalWidth = pixelWidth;
        int finalHeight = pixelHeight;

        // Downscale if needed
        if (pixelWidth > MaxDimension || pixelHeight > MaxDimension)
        {
            float scale = (float)MaxDimension / Mathf.Max(pixelWidth, pixelHeight);
            finalWidth = Mathf.Max(1, Mathf.RoundToInt(pixelWidth * scale));
            finalHeight = Mathf.Max(1, Mathf.RoundToInt(pixelHeight * scale));

            var rt = RenderTexture.GetTemporary(finalWidth, finalHeight, 0, RenderTextureFormat.ARGB32);
            rt.filterMode = FilterMode.Bilinear;

            RenderTexture.active = rt;
            Graphics.Blit(texture, rt);

            var scaled = new Texture2D(finalWidth, finalHeight, TextureFormat.RGB24, false);
            scaled.ReadPixels(new Rect(0, 0, finalWidth, finalHeight), 0, 0);
            scaled.Apply();

            RenderTexture.active = null;
            RenderTexture.ReleaseTemporary(rt);
            UnityEngine.Object.DestroyImmediate(texture);
            texture = scaled;
        }

        // Encode to JPEG
        byte[] imageBytes = texture.EncodeToJPG(JpegQuality);
        UnityEngine.Object.DestroyImmediate(texture);

        // Base64 encode
        string base64 = Convert.ToBase64String(imageBytes);

        return new ScreenshotResult
        {
            success = true,
            imageBase64 = base64,
            width = finalWidth,
            height = finalHeight,
            source = source,
            byteSize = imageBytes.Length
        };
    }

    private static EditorWindow FindWindow(string source)
    {
        if (source == "sceneView")
        {
            return SceneView.lastActiveSceneView;
        }

        if (source == "gameView")
        {
            var gameViewType = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView");
            if (gameViewType == null)
                throw new Exception("GameView type not found via reflection");

            // false for last param = don't focus the window
            return EditorWindow.GetWindow(gameViewType, false, null, false);
        }

        throw new Exception($"Unknown source: '{source}'. Use 'sceneView' or 'gameView'.");
    }

    private static string NormalizeSource(string source)
    {
        if (string.IsNullOrEmpty(source)) return "sceneView";

        string normalized = source.Replace("_", "").Replace("-", "").Replace(" ", "").ToLowerInvariant();

        switch (normalized)
        {
            case "sceneview":
            case "scene":
            case "scenecamera":
            case "scenewindow":
                return "sceneView";

            case "gameview":
            case "game":
            case "gamecamera":
            case "gamewindow":
                return "gameView";

            default:
                return source;
        }
    }
}
#endif
