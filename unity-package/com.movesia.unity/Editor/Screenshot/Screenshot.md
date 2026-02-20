# Screenshot API

Captures the Unity Editor's Scene View or Game View and returns the image as a base64-encoded JPEG string inside the standard JSON response envelope.

## Message Type

`capture_screenshot`

## Request

```json
{
  "type": "capture_screenshot",
  "id": "req-123",
  "body": {
    "source": "sceneView"
  }
}
```

### Parameters

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `source` | string | `"sceneView"` | Which editor window to capture: `"sceneView"` or `"gameView"` |

`source` is the only parameter. All image settings are hardcoded (see below). The field name is fuzzy-matched, so `"view"`, `"window"`, `"target"`, `"viewType"`, and `"captureSource"` all resolve to `source`.

The source value itself is also fuzzy-matched:

| Input | Resolves to |
|-------|-------------|
| `"sceneView"`, `"scene"`, `"scene_view"`, `"sceneWindow"`, `"sceneCamera"` | `"sceneView"` |
| `"gameView"`, `"game"`, `"game_view"`, `"gameWindow"`, `"gameCamera"` | `"gameView"` |

## Response

```json
{
  "source": "unity",
  "type": "screenshot_result",
  "id": "req-123",
  "body": {
    "success": true,
    "imageBase64": "/9j/4AAQ...",
    "width": 768,
    "height": 432,
    "source": "sceneView",
    "byteSize": 87234
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | bool | `true` if capture succeeded |
| `error` | string | Error message when `success` is `false` (absent on success) |
| `imageBase64` | string | Base64-encoded JPEG image data |
| `width` | int | Final image width in pixels (after downscale) |
| `height` | int | Final image height in pixels (after downscale) |
| `source` | string | Which view was captured (`"sceneView"` or `"gameView"`) |
| `byteSize` | int | Size of the JPEG data in bytes (before base64 encoding) |

## Hardcoded Settings

| Setting | Value | Rationale |
|---------|-------|-----------|
| Format | JPEG | PNG is 5-10x larger for zero benefit to the vision model |
| Quality | 70 | Good enough to read gizmos and text, small enough to be fast |
| Max dimension | 768px | Sweet spot for vision model token usage; the longest edge is capped at 768px, the other edge scales proportionally to preserve aspect ratio |

## How It Works

1. The handler receives the message, normalizes the `source` field, and calls `ScreenshotManager.CaptureScreenshot(source)`.

2. `ScreenshotManager` locates the target editor window:
   - **Scene View**: `SceneView.lastActiveSceneView`
   - **Game View**: reflection into `UnityEditor.GameView` (internal type) via `EditorWindow.GetWindow`

3. `InternalEditorUtility.ReadScreenPixel` captures the window's pixels at physical resolution (DPI-aware via `EditorGUIUtility.pixelsPerPoint`).

4. A `Texture2D` is created from the pixel data. If either dimension exceeds 768px, the texture is GPU-downscaled using `Graphics.Blit` to a smaller `RenderTexture`, preserving aspect ratio.

5. The texture is encoded to JPEG at quality 70, base64-encoded, and returned in the response. All GPU resources (`Texture2D`, `RenderTexture`) are destroyed immediately after use.

## Error Responses

```json
{ "success": false, "error": "Scene View is not open" }
```

| Error | Cause |
|-------|-------|
| `"Scene View is not open"` | No Scene View window exists |
| `"Game View is not open"` | No Game View window exists |
| `"Target window has zero size (minimized?)"` | Window is minimized or has zero dimensions |
| `"GameView type not found via reflection"` | Unity internals changed (unlikely) |
| `"Unknown source: '...'. Use 'sceneView' or 'gameView'."` | Unrecognized source value that didn't fuzzy-match |

## Limitations

- **Window occlusion**: `ReadScreenPixel` reads from the OS framebuffer. If another window covers the target editor view, those pixels will appear in the capture. The target window must be visible on screen.
- **No UI-only capture**: The capture includes everything rendered in the view — gizmos, grid, selection outlines, overlays. There is no option to capture a "clean" render.
- **Stale framebuffer**: Since the capture is synchronous, if called immediately after a scene change the framebuffer may contain pixels from the previous frame. The agent should allow a moment between making changes and capturing.

## Files

| File | Purpose |
|------|---------|
| `Editor/Screenshot/ScreenshotManager.cs` | Core capture logic: window discovery, pixel read, downscale, encode, base64 |
| `Editor/Screenshot/ScreenshotHandlers.cs` | Message handler: parses `source` param, calls manager, sends response |
| `Editor/Handlers/MessageRouter.cs` | Routes `"capture_screenshot"` to `ScreenshotHandlers.HandleCaptureScreenshot` |
