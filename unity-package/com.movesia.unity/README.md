# Unity Editor WebSocket API

A WebSocket-based API for extracting real-time data from the Unity Editor, designed for AI agent integration.

## Overview

This plugin establishes a persistent WebSocket connection between the Unity Editor and external services (e.g., AI agents, automation tools). It provides on-demand access to:

- **Scene Hierarchy** - Full GameObject tree with components
- **Project Settings** - Build, quality, physics, rendering configuration
- **Console Logs** - Buffered editor logs with filtering
- **Component Data** - Detailed component properties via reflection

## Connection Details

| Property           | Value                         |
| ------------------ | ----------------------------- |
| **URL**            | `ws://127.0.0.1:8765`         |
| **Protocol**       | WebSocket (RFC 6455)          |
| **Serialization**  | JSON (Newtonsoft.Json)        |
| **Heartbeat**      | Every 25-35 seconds           |
| **Auto-reconnect** | Yes, with exponential backoff |

## Message Protocol

### Request Envelope

All requests follow this structure:

```json
{
  "type": "<message_type>",
  "id": "<unique_request_id>",
  "body": { ... }
}
```

| Field  | Type   | Required | Description                                        |
| ------ | ------ | -------- | -------------------------------------------------- |
| `type` | string | Yes      | The request type (see endpoints below)             |
| `id`   | string | Yes      | Unique identifier for request/response correlation |
| `body` | object | No       | Request parameters (endpoint-specific)             |

### Response Envelope

Responses mirror the request ID for correlation:

```json
{
  "type": "<response_type>",
  "id": "<original_request_id>",
  "ts": 1704067200,
  "body": { ... }
}
```

| Field  | Type   | Description                                       |
| ------ | ------ | ------------------------------------------------- |
| `type` | string | Response type (usually `<request_type>_response`) |
| `id`   | string | Matches the request's `id` field                  |
| `ts`   | number | Unix timestamp (seconds)                          |
| `body` | object | Response payload                                  |

---

## API Endpoints

### 1. Ping

Health check and latency measurement.

**Request:**

```json
{
  "type": "ping",
  "id": "ping-001",
  "body": {}
}
```

**Response:**

```json
{
  "type": "pong",
  "id": "ping-001",
  "ts": 1704067200,
  "body": {
    "serverTime": 1704067200000
  }
}
```

---

### 2. Get Hierarchy

Retrieves the full scene hierarchy with all GameObjects and their components.

**Request:**

```json
{
  "type": "get_hierarchy",
  "id": "hier-001",
  "body": {
    "maxDepth": 10
  }
}
```

| Parameter  | Type | Default | Description                        |
| ---------- | ---- | ------- | ---------------------------------- |
| `maxDepth` | int  | 10      | Maximum depth to traverse children |

**Response:**

```json
{
  "type": "hierarchy_response",
  "id": "hier-001",
  "ts": 1704067200,
  "body": {
    "timestamp": 1704067200000,
    "sceneCount": 1,
    "scenes": [
      {
        "name": "SampleScene",
        "path": "Assets/Scenes/SampleScene.unity",
        "buildIndex": 0,
        "isDirty": false,
        "isLoaded": true,
        "isActive": true,
        "rootCount": 3,
        "rootObjects": [
          {
            "instanceId": 12345,
            "name": "Main Camera",
            "activeSelf": true,
            "activeInHierarchy": true,
            "tag": "MainCamera",
            "layer": "Default",
            "components": ["Transform", "Camera", "AudioListener"],
            "childCount": 0,
            "children": []
          }
        ]
      }
    ]
  }
}
```

**GameObject Data Structure:**

| Field               | Type     | Description                                           |
| ------------------- | -------- | ----------------------------------------------------- |
| `instanceId`        | int      | Unity's unique instance ID (use for `get_components`) |
| `name`              | string   | GameObject name                                       |
| `activeSelf`        | bool     | Local active state                                    |
| `activeInHierarchy` | bool     | Effective active state (considers parents)            |
| `tag`               | string   | Unity tag                                             |
| `layer`             | string   | Layer name                                            |
| `components`        | string[] | List of component type names                          |
| `childCount`        | int      | Number of direct children                             |
| `children`          | array    | Nested GameObjectData (respects maxDepth)             |

---

### 3. Get Scenes

Retrieves scene metadata without the full hierarchy (lightweight).

**Request:**

```json
{
  "type": "get_scenes",
  "id": "scenes-001",
  "body": {}
}
```

**Response:**

```json
{
  "type": "scenes_response",
  "id": "scenes-001",
  "ts": 1704067200,
  "body": {
    "count": 2,
    "scenes": [
      {
        "name": "MainMenu",
        "path": "Assets/Scenes/MainMenu.unity",
        "buildIndex": 0,
        "isDirty": false,
        "isLoaded": true,
        "isActive": true,
        "rootCount": 5,
        "rootObjects": null
      },
      {
        "name": "GameLevel",
        "path": "Assets/Scenes/GameLevel.unity",
        "buildIndex": 1,
        "isDirty": true,
        "isLoaded": true,
        "isActive": false,
        "rootCount": 42,
        "rootObjects": null
      }
    ]
  }
}
```

---

### 4. Get Components

Retrieves detailed component data for a specific GameObject using `EditorJsonUtility`.

**Request:**

```json
{
  "type": "get_components",
  "id": "comp-001",
  "body": {
    "instanceId": 12345
  }
}
```

| Parameter    | Type | Required | Description                             |
| ------------ | ---- | -------- | --------------------------------------- |
| `instanceId` | int  | Yes      | GameObject's instance ID from hierarchy |

**Response:**

```json
{
  "type": "components_response",
  "id": "comp-001",
  "ts": 1704067200,
  "body": {
    "gameObjectInstanceId": 12345,
    "gameObjectName": "Player",
    "count": 3,
    "components": [
      {
        "instanceId": 12346,
        "type": "Transform",
        "enabled": true,
        "properties": {
          "m_LocalPosition": { "x": 0, "y": 1, "z": 0 },
          "m_LocalRotation": { "x": 0, "y": 0, "z": 0, "w": 1 },
          "m_LocalScale": { "x": 1, "y": 1, "z": 1 }
        }
      },
      {
        "instanceId": 12347,
        "type": "Rigidbody",
        "enabled": true,
        "properties": {
          "m_Mass": 1.0,
          "m_Drag": 0,
          "m_AngularDrag": 0.05,
          "m_UseGravity": true,
          "m_IsKinematic": false
        }
      }
    ]
  }
}
```

**Error Response (GameObject not found):**

```json
{
  "type": "error_response",
  "id": "comp-001",
  "ts": 1704067200,
  "body": {
    "error": "GameObject not found",
    "instanceId": 99999
  }
}
```

---

### 5. Get Project Settings

Retrieves comprehensive project configuration.

**Request (Full Snapshot):**

```json
{
  "type": "get_project_settings",
  "id": "settings-001",
  "body": {}
}
```

**Request (Specific Category):**

```json
{
  "type": "get_project_settings",
  "id": "settings-002",
  "body": {
    "category": "build"
  }
}
```

| Parameter  | Type   | Required | Description                   |
| ---------- | ------ | -------- | ----------------------------- |
| `category` | string | No       | Specific category to retrieve |

**Valid Categories:**

- `environment` - Unity version, platform, project info
- `player` - Product name, screen settings, identifiers
- `build` - Build target, scripting backend, defines
- `quality` - Quality levels, shadows, AA, vsync
- `physics` - Gravity, solver iterations, thresholds
- `time` - Fixed timestep, timescale
- `audio` - Speaker mode, sample rate, voices
- `rendering` - Color space, graphics APIs, render pipeline
- `packages` - Installed packages (non-built-in)

**Response (Full Snapshot):**

```json
{
  "type": "project_settings_response",
  "id": "settings-001",
  "ts": 1704067200,
  "body": {
    "timestamp": 1704067200000,
    "environment": {
      "unityVersion": "2022.3.20f1",
      "platform": "WindowsEditor",
      "projectPath": "C:/Projects/MyGame",
      "projectName": "MyGame"
    },
    "player": {
      "productName": "My Awesome Game",
      "companyName": "GameStudio",
      "bundleVersion": "1.0.0",
      "applicationIdentifier": "com.gamestudio.myawesomegame",
      "defaultScreenWidth": 1920,
      "defaultScreenHeight": 1080,
      "fullScreenMode": "FullScreenWindow",
      "runInBackground": true
    },
    "build": {
      "activeBuildTarget": "StandaloneWindows64",
      "scriptingBackend": "IL2CPP",
      "apiCompatibilityLevel": "NET_Standard_2_1",
      "il2CppCompilerConfiguration": "Release",
      "managedStrippingLevel": "Medium",
      "scriptingDefineSymbols": "UNITY_POST_PROCESSING;ENABLE_VR",
      "allowUnsafeCode": false,
      "development": false
    },
    "quality": {
      "names": ["Low", "Medium", "High", "Ultra"],
      "currentLevel": 2,
      "currentName": "High",
      "vSyncCount": 1,
      "antiAliasing": 4,
      "shadowQuality": "All",
      "shadowDistance": 150,
      "pixelLightCount": 4,
      "textureQuality": "0",
      "anisotropicFiltering": "Enable"
    },
    "physics": {
      "gravityX": 0,
      "gravityY": -9.81,
      "gravityZ": 0,
      "defaultSolverIterations": 6,
      "defaultSolverVelocityIterations": 1,
      "bounceThreshold": 2,
      "sleepThreshold": 0.005,
      "defaultContactOffset": 0.01,
      "autoSimulation": true,
      "autoSyncTransforms": false
    },
    "time": {
      "fixedDeltaTime": 0.02,
      "maximumDeltaTime": 0.3333333,
      "timeScale": 1,
      "maximumParticleDeltaTime": 0.03
    },
    "audio": {
      "speakerMode": "Stereo",
      "sampleRate": 48000,
      "dspBufferSize": 1024,
      "numRealVoices": 32,
      "numVirtualVoices": 512
    },
    "rendering": {
      "colorSpace": "Linear",
      "graphicsAPIs": ["Direct3D12", "Direct3D11"],
      "graphicsJobs": true,
      "renderPipeline": "URP",
      "renderPipelineAsset": "UniversalRenderPipelineAsset",
      "gpuSkinning": true,
      "stripEngineCode": true,
      "gcIncremental": true
    },
    "packages": [
      {
        "name": "com.unity.render-pipelines.universal",
        "version": "14.0.9",
        "source": "Registry"
      },
      {
        "name": "com.unity.inputsystem",
        "version": "1.7.0",
        "source": "Registry"
      },
      {
        "name": "com.unity.textmeshpro",
        "version": "3.0.6",
        "source": "Registry"
      }
    ]
  }
}
```

**Error Response (Invalid Category):**

```json
{
  "type": "error_response",
  "id": "settings-002",
  "ts": 1704067200,
  "body": {
    "error": "Unknown category: invalid",
    "validCategories": [
      "environment",
      "player",
      "build",
      "quality",
      "physics",
      "time",
      "audio",
      "rendering",
      "packages"
    ]
  }
}
```

---

### 6. Get Logs

Retrieves buffered console logs (max 100 entries).

**Request (All Logs):**

```json
{
  "type": "get_logs",
  "id": "logs-001",
  "body": {}
}
```

**Request (Filtered by Type):**

```json
{
  "type": "get_logs",
  "id": "logs-002",
  "body": {
    "filter": "Warning"
  }
}
```

**Request (Limited Count):**

```json
{
  "type": "get_logs",
  "id": "logs-003",
  "body": {
    "limit": 10
  }
}
```

| Parameter | Type   | Default | Description                                                |
| --------- | ------ | ------- | ---------------------------------------------------------- |
| `filter`  | string | null    | Log type: `Log`, `Warning`, `Error`, `Exception`, `Assert` |
| `limit`   | int    | 100     | Max entries to return (recent logs)                        |

**Response:**

```json
{
  "type": "logs_response",
  "id": "logs-001",
  "ts": 1704067200,
  "body": {
    "count": 3,
    "logs": [
      {
        "message": "Player spawned at position (0, 1, 0)",
        "stackTrace": "",
        "type": "Log",
        "timestamp": 1704067190000
      },
      {
        "message": "Missing reference on Enemy prefab",
        "stackTrace": "EnemySpawner.Spawn() at Assets/Scripts/EnemySpawner.cs:42",
        "type": "Warning",
        "timestamp": 1704067195000
      },
      {
        "message": "NullReferenceException: Object reference not set",
        "stackTrace": "PlayerController.Update() at Assets/Scripts/PlayerController.cs:87\nUnityEngine.MonoBehaviour:Update()",
        "type": "Exception",
        "timestamp": 1704067198000
      }
    ]
  }
}
```

---

### 7. Get Errors

Convenience endpoint that returns only Error and Exception logs.

**Request:**

```json
{
  "type": "get_errors",
  "id": "errors-001",
  "body": {}
}
```

**Response:**

```json
{
  "type": "errors_response",
  "id": "errors-001",
  "ts": 1704067200,
  "body": {
    "count": 2,
    "logs": [
      {
        "message": "Failed to load asset bundle",
        "stackTrace": "AssetManager.LoadBundle() at Assets/Scripts/AssetManager.cs:156",
        "type": "Error",
        "timestamp": 1704067180000
      },
      {
        "message": "IndexOutOfRangeException",
        "stackTrace": "InventorySystem.AddItem() at Assets/Scripts/InventorySystem.cs:203",
        "type": "Exception",
        "timestamp": 1704067185000
      }
    ]
  }
}
```

---

### 8. Clear Logs

Clears the log buffer.

**Request:**

```json
{
  "type": "clear_logs",
  "id": "clear-001",
  "body": {}
}
```

**Response:**

```json
{
  "type": "clear_response",
  "id": "clear-001",
  "ts": 1704067200,
  "body": {
    "success": true
  }
}
```

---

## Usage Examples

### Python Client

```python
import asyncio
import websockets
import json
import uuid

async def query_unity():
    uri = "ws://127.0.0.1:8765"

    async with websockets.connect(uri) as ws:
        # Get hierarchy
        request = {
            "type": "get_hierarchy",
            "id": str(uuid.uuid4()),
            "body": {"maxDepth": 5}
        }
        await ws.send(json.dumps(request))
        response = json.loads(await ws.recv())

        # Find all GameObjects with Rigidbody
        for scene in response["body"]["scenes"]:
            for obj in scene.get("rootObjects", []):
                if "Rigidbody" in obj["components"]:
                    # Get detailed component data
                    comp_request = {
                        "type": "get_components",
                        "id": str(uuid.uuid4()),
                        "body": {"instanceId": obj["instanceId"]}
                    }
                    await ws.send(json.dumps(comp_request))
                    comp_response = json.loads(await ws.recv())
                    print(f"Rigidbody found on: {obj['name']}")
                    print(json.dumps(comp_response["body"], indent=2))

asyncio.run(query_unity())
```

### JavaScript/Node.js Client

```javascript
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const ws = new WebSocket("ws://127.0.0.1:8765");

ws.on("open", () => {
  // Get project settings
  ws.send(
    JSON.stringify({
      type: "get_project_settings",
      id: uuidv4(),
      body: { category: "build" },
    })
  );
});

ws.on("message", (data) => {
  const response = JSON.parse(data);
  console.log(`Received ${response.type}:`, response.body);
});
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Unity Editor                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐     ┌──────────────────┐                  │
│  │  WebSocketClient │────▶│  MessageHandler  │                  │
│  │                  │◀────│                  │                  │
│  │  - Connection    │     │  - Route msgs    │                  │
│  │  - Heartbeat     │     │  - Send response │                  │
│  │  - Reconnect     │     │                  │                  │
│  └──────────────────┘     └────────┬─────────┘                  │
│                                    │                             │
│           ┌────────────────────────┼────────────────────────┐   │
│           │                        │                        │   │
│           ▼                        ▼                        ▼   │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────┐ │
│  │ HierarchyTracker│    │ProjectSettings   │    │ConsoleLog  │ │
│  │                 │    │    Tracker       │    │  Buffer    │ │
│  │ - Scene tree    │    │                  │    │            │ │
│  │ - GameObjects   │    │ - Environment    │    │ - 100 logs │ │
│  │ - Components    │    │ - Player/Build   │    │ - Filtering│ │
│  └─────────────────┘    │ - Quality/Audio  │    └────────────┘ │
│           │             │ - Physics/Time   │                    │
│           │             │ - Rendering      │                    │
│           │             │ - Packages       │                    │
│           │             └──────────────────┘                    │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐                                            │
│  │ComponentInspector│                                           │
│  │                 │                                            │
│  │ - EditorJson    │                                            │
│  │ - Full props    │                                            │
│  └─────────────────┘                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
          │
          │ WebSocket (ws://127.0.0.1:8765)
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AI Agent / Client                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Session Management

The plugin maintains a persistent session ID stored in `EditorPrefs`:

- **Key:** `Movesia_SessionId`
- **Format:** GUID (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)
- **Lifecycle:** Created on first editor load, persists across sessions

This allows reconnecting clients to identify themselves to the Unity instance.

---

## Heartbeat Protocol

The client sends periodic heartbeats to keep the connection alive:

```json
{
  "type": "hb",
  "id": null,
  "ts": 1704067200,
  "body": {
    "ts": 1704067200
  }
}
```

- **Interval:** 25-35 seconds (randomized to prevent thundering herd)
- **Purpose:** NAT keepalive, connection health monitoring

---

## Error Handling

| Error Type           | Response                            |
| -------------------- | ----------------------------------- |
| Unknown message type | Logged, no response sent            |
| Invalid JSON         | Warning logged, no response         |
| GameObject not found | `error_response` with details       |
| Invalid category     | `error_response` with valid options |

---

## Performance Considerations

1. **Hierarchy Depth:** Use `maxDepth` parameter to limit traversal in deep hierarchies
2. **Log Buffer:** Limited to 100 entries to prevent memory issues
3. **Component Inspection:** Only request components when needed (uses reflection)
4. **Package List:** Excludes built-in packages to reduce payload size

---

## Unity Menu Commands

Debug commands available under **Tools > WebSocket**:

| Command               | Description                            |
| --------------------- | -------------------------------------- |
| **Reconnect**         | Force reconnection to WebSocket server |
| **Disconnect**        | Close connection (no auto-reconnect)   |
| **Send Test Message** | Send a test ping to verify connection  |

---

## Requirements

- **Unity:** 2021.3+ (tested on 2022.3 LTS)
- **Dependencies:**
  - [NativeWebSocket](https://github.com/endel/NativeWebSocket)
  - [Newtonsoft.Json](https://www.newtonsoft.com/json) (Json.NET)
- **Platform:** Editor only (`#if UNITY_EDITOR`)
