# CLAUDE.md — com.movesia.unity

## What This Package Is

A **Unity Editor-only package** that acts as a WebSocket bridge, allowing an external AI agent (running on a local server) to remotely inspect and manipulate a Unity project in real time. The agent sends JSON commands over WebSocket; this package receives them, executes the corresponding Unity Editor API calls, and sends JSON responses back.

**This is NOT a runtime package.** All code is editor-only (`#if UNITY_EDITOR`, asmdef `includePlatforms: ["Editor"]`).

## Architecture Overview

```
External Agent (Python/Node server at ws://127.0.0.1:8765/ws/unity)
    ↕ WebSocket (JSON envelopes)
WebSocketClient.cs  ← auto-connects on editor load via [InitializeOnLoad]
    ↓ incoming messages queued to ConcurrentQueue
    ↓ dispatched on main thread via EditorApplication.update
Editor/Handlers/MessageRouter.cs ← routes by "type" field to handler files
    ↓
┌─────────────────────────────────────────────────────────┐
│ Handler Files (Editor/Handlers/, parse body + dispatch):│
│  • LogHandlers          (ping, get_logs, get_errors)    │
│  • HierarchyHandlers    (hierarchy reads + GO CRUD)     │
│  • ComponentHandlers    (add/remove/modify components)  │
│  • PrefabHandlers       (unified + legacy prefab ops)   │
│  • SceneHandlers        (scene CRUD)                    │
│  • AssetHandlers        (search + deletion)             │
│  • MaterialHandlers     (material + list_shaders)       │
│  • CompilationHandlers  (refresh + status + types)      │
└─────────────────────────────────────────────────────────┘
    ↓ delegates to
┌─────────────────────────────────────────────────┐
│ Manager Classes (all static, all editor-only):  │
│  • HierarchyTracker      (read scene tree)      │
│  • HierarchyManipulator  (CRUD GameObjects)     │
│  • ComponentInspector     (dump component JSON)  │
│  • PrefabManager          (prefab operations)    │
│  • SceneManagement        (scene CRUD)           │
│  • AssetSearch            (find assets)           │
│  • DeletionManager        (delete assets safely) │
│  • MaterialManager        (create/modify materials)│
│  • CompilationManager     (refresh + recompile)  │
│  • ProjectSettingsTracker (read project config)  │
│  • ConsoleLogBuffer       (capture Unity logs)   │
└─────────────────────────────────────────────────┘
```

## Message Protocol

Every message (both directions) is a JSON envelope:

```json
{
  "source": "unity",
  "type": "<message_type>",
  "ts": 1700000000000,
  "id": "<requestId or null>",
  "body": { ... }
}
```

- `type` determines the handler (e.g., `"get_hierarchy"`, `"create_gameobject"`)
- `id` is the request correlation ID — responses echo it back so the agent can match request/response
- `body` contains type-specific payload

## Key Files

| File | Purpose |
|------|---------|
| `package.json` | UPM manifest. Depends on `com.unity.nuget.newtonsoft-json`. Min Unity 2021.3 |
| `Editor/WebSocketClient.cs` | `[InitializeOnLoad]` static class. Manages WS connection lifecycle: auto-connect, heartbeat (25s + jitter), exponential backoff reconnection, session persistence via `EditorPrefs`. Connects to `ws://127.0.0.1:8765/ws/unity` |
| `Editor/Handlers/MessageRouter.cs` | Central message router. `switch(type)` dispatching ~37 message types to handler classes. Also contains `NormalizeKeys` fuzzy key utility and `SendResponse` helper |
| `Editor/Handlers/LogHandlers.cs` | Handles ping, get_logs, get_errors, clear_logs |
| `Editor/Handlers/HierarchyHandlers.cs` | Handles hierarchy reads (get_hierarchy, get_scenes, get_components, get_project_settings) and all GameObject manipulation (create, duplicate, destroy, rename, set_parent, etc.) |
| `Editor/Handlers/ComponentHandlers.cs` | Handles add_component, remove_component, modify_component |
| `Editor/Handlers/PrefabHandlers.cs` | Handles unified "prefab" endpoint and all legacy prefab operations. Contains `PrefabCanonicalMap` for fuzzy key normalization |
| `Editor/Handlers/SceneHandlers.cs` | Handles create_scene, open_scene, save_scene, set_active_scene |
| `Editor/Handlers/AssetHandlers.cs` | Handles search_assets, get_asset_labels, get_type_aliases, delete_assets |
| `Editor/Handlers/MaterialHandlers.cs` | Handles unified "material" endpoint and list_shaders. Contains `MaterialCanonicalMap` and `ListShadersCanonicalMap` for fuzzy key normalization |
| `Editor/Handlers/CompilationHandlers.cs` | Handles refresh_assets, get_compilation_status, get_available_types |
| `Editor/HierarchyTracker.cs` | Read-only scene hierarchy capture. Returns `HierarchySnapshot` with scenes, GameObjects (recursive with depth limit), components, prefab info |
| `Editor/HierarchyManipulator.cs` | Full GameObject CRUD with Undo support. Create (empty/primitive), duplicate, destroy, rename, reparent, reorder, move-to-scene, set-active, set-transform. Also handles `ModifyComponent` using `SerializedObject`/`SerializedProperty` for type-safe property editing |
| `Editor/ComponentInspector.cs` | Dumps component data as raw JSON via `EditorJsonUtility.ToJson()` |
| `Editor/PrefabManager.cs` | Prefab operations: list, instantiate (by path or name search), create from GO, create variant, apply/revert/unpack instances, open in prefab mode, edit prefab assets directly, modify prefab properties via `SerializedObject` |
| `Editor/SceneManager.cs` | Scene operations: create (empty/default), open (single/additive), save, set active. Class named `SceneManagement` to avoid conflict with `UnityEngine.SceneManagement` |
| `Editor/AssetSearch.cs` | Asset search with type aliases (e.g., "script" → "MonoScript", "audio" → "AudioClip"), name/label/folder/extension filtering |
| `Editor/DeletionManager.cs` | Safe asset deletion using `MoveAssetsToTrash` (OS recycle bin). Persists pending requests across domain reloads when deleting scripts |
| `Editor/MaterialManager.cs` | Unified smart material endpoint (`"material"`) — single message creates, modifies, and/or assigns materials. Auto-detects URP/built-in shaders, resolves friendly property names via alias dictionary (e.g., `"color"` → `_BaseColor`/`_Color`). Separate `"list_shaders"` query for shader discovery |
| `Editor/CompilationManager.cs` | Triggers `AssetDatabase.Refresh()`, tracks compilation via `CompilationPipeline` events, persists pending requests across domain reloads, sends deferred responses after recompilation completes |
| `Editor/ConsoleLogBuffer.cs` | Circular buffer (100 entries) capturing Unity console logs. Backfills existing console entries on init via reflection into `UnityEditor.LogEntries` |
| `Editor/ProjectSettingsTracker.cs` | Reads Unity project settings: environment, player, build, quality, physics, time, audio, rendering, packages |
| `Editor/WebSocket/WebSocket.cs` | NativeWebSocket library (vendored). Provides `ClientWebSocket` wrapper for editor, JSLIB bridge for WebGL. Namespace: `NativeWebSocket` |

## Assembly Structure

- **`Movesia.Connection.Editor`** (`Editor/Movesia.Connection.Editor.asmdef`)
  - Root namespace: `Movesia.Connection`
  - Editor-only platform
  - References: `Movesia.WebSocket`, `Newtonsoft.Json.dll`
  - Contains all handler classes and `WebSocketClient`

- **`Movesia.WebSocket`** (`Editor/WebSocket/Movesia.WebSocket.asmdef`)
  - The vendored NativeWebSocket library
  - No platform restrictions in asmdef (but code uses `#if UNITY_WEBGL` conditionals)

## Critical Patterns

### Domain Reload Survival
When scripts are created/deleted/modified, Unity triggers a domain reload that destroys all static state. Two managers handle this:
- **CompilationManager**: Saves pending request to `Temp/movesia_pending_compilation.json` before `AssetDatabase.Refresh()`. After reload, `[InitializeOnLoad]` static constructor checks for pending file, waits for WebSocket reconnection, then sends deferred response.
- **DeletionManager**: Same pattern for script file deletions → `Temp/movesia_pending_deletion.json`.

### Main Thread Dispatch
WebSocket messages arrive on background threads. `WebSocketClient` enqueues them into a `ConcurrentQueue<string>`. `EditorApplication.update` callback dequeues and processes on the main thread (required for all Unity API calls).

### Undo Support
All `HierarchyManipulator` operations use Unity's `Undo` system (`Undo.RegisterCreatedObjectUndo`, `Undo.DestroyObjectImmediate`, `Undo.RecordObject`, etc.), making all agent actions undoable by the user.

### SerializedProperty Type Mapping
`HierarchyManipulator.SetPropertyValue()` maps JSON values to Unity `SerializedProperty` types. Supports: int, bool, float/double, string, Color, Vector2/3/4, Quaternion (accepts euler[3] or xyzw[4]), Rect, Bounds, enums (by index or name), ObjectReference (by instanceId), arrays/lists (Generic), LayerMask. NOT supported: AnimationCurve, Gradient, ExposedReference, ManagedReference.

### Material Property Aliases
`MaterialManager` uses a property alias dictionary so the agent can use friendly names instead of shader-specific property names. Resolution uses `material.HasProperty()` to pick the first matching candidate:
- `color`/`baseColor`/`albedo` → `_BaseColor` (URP) or `_Color` (built-in)
- `mainTexture`/`baseMap` → `_BaseMap` (URP) or `_MainTex` (built-in)
- `metallic` → `_Metallic`
- `smoothness`/`glossiness` → `_Smoothness` (URP) or `_Glossiness` (built-in)
- `normalMap` → `_BumpMap`
- `emissionColor` → `_EmissionColor`
- When no shader is specified, auto-detects URP Lit first (`Universal Render Pipeline/Lit`), then falls back to `Standard`

### Custom WebSocket Close Codes
The server uses custom close codes (4000-4999 range):
- `4001` Superseded — another connection replaced this one, don't reconnect
- `4002` DuplicateSession
- `4003` AuthenticationFailed
- `4004` SessionExpired
- `4005` CompilationReset
- `4006` ProjectMismatch — server is connected to a different Unity project, don't reconnect

### Session Management
`WebSocketClient.SessionId` is persisted in `EditorPrefs` under key `"Movesia_SessionId"`. Created once as a GUID and reused across domain reloads. Passed as query parameter on WebSocket URL along with connection sequence number and project path.

## Conventions

- **All classes are static** — no MonoBehaviour/ScriptableObject instances
- **All code is wrapped in `#if UNITY_EDITOR`** preprocessor guards
- **Result objects** follow a consistent pattern: `{ success: bool, error: string?, ...data }`
- **Instance IDs** are the primary way to reference GameObjects and Components across messages
- **Paths** are normalized to start with `"Assets/"` and include proper extensions
- **Error handling**: try/catch in every handler, errors returned as result objects (never thrown to caller)
- **Logging** uses emoji prefixes for quick visual scanning in Unity console

## Common Tasks

### Adding a new message type
1. Add a `case "your_type":` in `MessageRouter.HandleMessage()` switch (in `Editor/Handlers/MessageRouter.cs`)
2. Add a `HandleYourType(string requestId, JToken body)` method in the appropriate `*Handlers.cs` file (or create a new one in `Editor/Handlers/`)
3. Extract parameters from `body` using `body?["param"]?.ToObject<T>()`
4. Call the appropriate manager class method
5. Send response via `await MessageRouter.SendResponse(requestId, "your_response_type", result)`

### Adding a new handler class
1. Create `Editor/YourManager.cs`
2. Wrap in `#if UNITY_EDITOR`
3. Make it `public static class`
4. Define `[Serializable]` result data classes
5. Use `Undo.*` methods for any scene modifications
6. Return result objects with `success`/`error` fields

### Testing without the external server
- Use `Tools > WebSocket > Send Test Message` menu item
- Use `Tools > Movesia > Compilation > Check Status` to inspect compilation state
- WebSocket will continuously retry connection with exponential backoff (100ms → 500ms → up to 5s)

## Dependencies

- **Newtonsoft.Json** (`com.unity.nuget.newtonsoft-json` 3.2.1) — JSON serialization for message protocol
- **NativeWebSocket** (vendored in `Editor/WebSocket/`) — WebSocket client implementation

## Known Limitations

- No Runtime assembly — this is purely an editor tool
- No tests directory exists yet
- No custom Editor UI/window — operates entirely headlessly via WebSocket
- `FindComponentType` is duplicated in `HierarchyManipulator` and `PrefabManager` (slightly different implementations)
- `ConsoleLogBuffer` backfill uses reflection into Unity internals (`UnityEditor.LogEntries`) which may break across Unity versions
- AnimationCurve, Gradient, and ManagedReference property types cannot be modified via the agent
