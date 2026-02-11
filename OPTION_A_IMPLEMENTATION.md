# Option A: Passive Clients + Server Discovery

## Overview

Flip the WebSocket architecture so Unity Editor instances are **servers** and the VS Code extension is the **client**. Unity registers itself via discovery files, the extension finds and connects to the right one.

**Current architecture (Option B):**
```
Unity A (client) ──connect──> VS Code Extension (server) <──connect── Unity B (client)
```

**New architecture (Option A):**
```
VS Code Extension (client) ──connect──> Unity A (server, port 8801)
                           ──connect──> Unity B (server, port 8802)  // only if needed
```

---

## Architecture

### Discovery Flow

```
1. Unity Editor starts
2. Unity starts a WebSocket server on a random available port
3. Unity writes a JSON file to ~/.movesia/instances/{pid}.json
4. VS Code extension watches ~/.movesia/instances/ directory
5. Extension reads discovery files, finds the one matching targetProjectPath
6. Extension connects as a WebSocket client to that Unity instance
7. When Unity closes, it deletes its discovery file
```

### Discovery File Format

Location: `~/.movesia/instances/{pid}.json`

```json
{
  "projectPath": "C:/Users/jimen/BeziTesting",
  "port": 8801,
  "pid": 12345,
  "sessionId": "abc-123",
  "unityVersion": "6000.0.23f1",
  "startedAt": 1707300000,
  "wsUrl": "ws://127.0.0.1:8801/ws"
}
```

---

## Unity Side Changes

### New File: `Editor/WebSocketServer.cs`

Replaces `WebSocketClient.cs`. Unity becomes a server instead of a client.

#### Responsibilities

1. Start an `HttpListener` on a random port
2. Accept WebSocket upgrade requests
3. Handle multiple client connections (though typically just one — the extension)
4. Write discovery file on start, delete on shutdown
5. Handle domain reloads (stop server before, restart after)

#### Implementation Outline

```csharp
#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using System;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;

[InitializeOnLoad]
public static class WebSocketServer
{
    private static HttpListener _listener;
    private static CancellationTokenSource _cts;
    private static int _port;
    private static WebSocket _activeClient;  // the connected extension
    private static readonly string DiscoveryDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".movesia", "instances"
    );

    static WebSocketServer()
    {
        EditorApplication.delayCall += StartServer;
        AssemblyReloadEvents.beforeAssemblyReload += StopServer;
        EditorApplication.quitting += () =>
        {
            StopServer();
            CleanupDiscoveryFile();
        };
    }

    // --- Server Lifecycle ---

    private static void StartServer()
    {
        if (_listener != null) return;

        _cts = new CancellationTokenSource();
        _port = FindAvailablePort();  // find a free port

        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://127.0.0.1:{_port}/");
        _listener.Start();

        WriteDiscoveryFile();
        _ = AcceptLoop(_cts.Token);

        Debug.Log($"Movesia WebSocket server started on port {_port}");
    }

    private static void StopServer()
    {
        _cts?.Cancel();

        if (_activeClient != null && _activeClient.State == System.Net.WebSockets.WebSocketState.Open)
        {
            // Close gracefully — extension will see this and know to reconnect after reload
            _ = _activeClient.CloseAsync(
                WebSocketCloseStatus.NormalClosure,
                "domain-reload",
                CancellationToken.None
            );
        }
        _activeClient = null;

        _listener?.Stop();
        _listener?.Close();
        _listener = null;
    }

    // --- Accept Loop ---

    private static async Task AcceptLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var context = await _listener.GetContextAsync();

                if (context.Request.IsWebSocketRequest)
                {
                    var wsContext = await context.AcceptWebSocketAsync(null);
                    _ = HandleClient(wsContext.WebSocket, ct);
                }
                else
                {
                    // Could serve a simple status JSON on HTTP GET
                    context.Response.StatusCode = 200;
                    context.Response.Close();
                }
            }
            catch (ObjectDisposedException) { break; }
            catch (HttpListenerException) { break; }
            catch (Exception ex)
            {
                Debug.LogWarning($"Accept error: {ex.Message}");
            }
        }
    }

    // --- Client Handling ---

    private static async Task HandleClient(WebSocket ws, CancellationToken ct)
    {
        // Close any previous client
        if (_activeClient != null && _activeClient.State == System.Net.WebSockets.WebSocketState.Open)
        {
            await _activeClient.CloseAsync(
                WebSocketCloseStatus.NormalClosure,
                "superseded",
                CancellationToken.None
            );
        }

        _activeClient = ws;
        Debug.Log("Extension connected");

        // Receive loop
        var buffer = new byte[8192];
        try
        {
            while (ws.State == System.Net.WebSockets.WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await ws.ReceiveAsync(
                    new ArraySegment<byte>(buffer), ct
                );

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(
                        WebSocketCloseStatus.NormalClosure,
                        "client disconnected",
                        CancellationToken.None
                    );
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var msg = System.Text.Encoding.UTF8.GetString(buffer, 0, result.Count);
                    // Queue for main thread processing (same pattern as current MessageHandler)
                    incomingMessages.Enqueue(msg);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Debug.LogWarning($"Client error: {ex.Message}");
        }
        finally
        {
            if (_activeClient == ws) _activeClient = null;
            Debug.Log("Extension disconnected");
        }
    }

    // --- Send (called by MessageHandler) ---

    public static async Task Send(string type, object body, string requestId = null)
    {
        if (_activeClient == null || _activeClient.State != System.Net.WebSockets.WebSocketState.Open)
        {
            Debug.LogWarning("Cannot send — no extension connected");
            return;
        }

        var envelope = new { source = "unity", type, ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), id = requestId, body };
        var json = JsonConvert.SerializeObject(envelope);
        var bytes = System.Text.Encoding.UTF8.GetBytes(json);

        await _activeClient.SendAsync(
            new ArraySegment<byte>(bytes),
            WebSocketMessageType.Text,
            true,
            CancellationToken.None
        );
    }

    // --- Discovery File ---

    private static void WriteDiscoveryFile()
    {
        Directory.CreateDirectory(DiscoveryDir);

        var projectPath = Application.dataPath.Replace("/Assets", "").Replace("\\Assets", "");
        var pid = System.Diagnostics.Process.GetCurrentProcess().Id;
        var filePath = Path.Combine(DiscoveryDir, $"{pid}.json");

        var discovery = new
        {
            projectPath,
            port = _port,
            pid,
            sessionId = Guid.NewGuid().ToString(),
            unityVersion = Application.unityVersion,
            startedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            wsUrl = $"ws://127.0.0.1:{_port}/ws"
        };

        File.WriteAllText(filePath, JsonConvert.SerializeObject(discovery, Formatting.Indented));
        Debug.Log($"Discovery file written: {filePath}");
    }

    private static void CleanupDiscoveryFile()
    {
        var pid = System.Diagnostics.Process.GetCurrentProcess().Id;
        var filePath = Path.Combine(DiscoveryDir, $"{pid}.json");

        try
        {
            if (File.Exists(filePath)) File.Delete(filePath);
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"Failed to clean up discovery file: {ex.Message}");
        }
    }

    // --- Port Discovery ---

    private static int FindAvailablePort()
    {
        // Let the OS pick a free port
        var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    // --- Main Thread Message Queue (same pattern as current WebSocketClient) ---

    private static readonly System.Collections.Concurrent.ConcurrentQueue<string> incomingMessages
        = new System.Collections.Concurrent.ConcurrentQueue<string>();

    // Called from EditorApplication.update
    // (register in static constructor same as current code)
}
#endif
```

#### Domain Reload Handling

Unity tears down and rebuilds the C# domain when scripts compile. The server must:

1. **Before reload**: Stop the `HttpListener`, close the active WebSocket client gracefully (send close with reason "domain-reload"), cancel the CTS
2. **After reload**: `[InitializeOnLoad]` static constructor fires again, `EditorApplication.delayCall` restarts the server on the **same port** if possible (or update the discovery file with the new port)
3. The extension sees the close, waits briefly, then reconnects

To preserve the port across reloads, store it in `EditorPrefs` or `SessionState`:

```csharp
// Before reload: save port
SessionState.SetInt("Movesia_ServerPort", _port);

// After reload: try to reuse same port
var savedPort = SessionState.GetInt("Movesia_ServerPort", 0);
if (savedPort > 0 && IsPortAvailable(savedPort))
    _port = savedPort;
else
    _port = FindAvailablePort();
```

#### Heartbeat

The current Unity client sends heartbeats every 25 seconds. With Option A, the extension (now the client) should send heartbeats instead. Unity server just responds to them. Alternatively, Unity can still send periodic heartbeats as the server — either direction works.

#### Edge Case: Crash Cleanup

If Unity crashes, the discovery file won't be deleted. The extension should handle this:

- When reading discovery files, check if the PID is still running (`Process.GetProcessById(pid)`)
- If the PID is dead, delete the stale discovery file
- If the PID is alive but the WebSocket connection fails, the file might be stale from a previous session — delete and ignore

---

## Extension Side Changes

### Replace: `src/agent/UnityConnection/`

The entire `UnityConnection/` folder changes from server to client.

#### New File: `src/agent/UnityConnection/UnityDiscovery.ts`

Watches `~/.movesia/instances/` for discovery files.

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface UnityInstance {
    projectPath: string;
    port: number;
    pid: number;
    sessionId: string;
    unityVersion?: string;
    startedAt: number;
    wsUrl: string;
}

const DISCOVERY_DIR = path.join(os.homedir(), '.movesia', 'instances');

/**
 * Scan for running Unity instances.
 * Reads all JSON files in ~/.movesia/instances/,
 * validates PIDs are still alive, cleans up stale files.
 */
export function discoverUnityInstances(): UnityInstance[] {
    if (!fs.existsSync(DISCOVERY_DIR)) return [];

    const instances: UnityInstance[] = [];
    const files = fs.readdirSync(DISCOVERY_DIR).filter(f => f.endsWith('.json'));

    for (const file of files) {
        const filePath = path.join(DISCOVERY_DIR, file);
        try {
            const data: UnityInstance = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

            // Validate PID is still alive
            if (isProcessRunning(data.pid)) {
                instances.push(data);
            } else {
                // Stale file — clean up
                fs.unlinkSync(filePath);
            }
        } catch {
            // Corrupt file — clean up
            try { fs.unlinkSync(filePath); } catch { }
        }
    }

    return instances;
}

/**
 * Find Unity instance matching a project path.
 */
export function findInstanceForProject(projectPath: string): UnityInstance | undefined {
    const instances = discoverUnityInstances();
    const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return instances.find(i => normalize(i.projectPath) === normalize(projectPath));
}

/**
 * Watch for new/removed Unity instances.
 */
export function watchInstances(
    onChange: (instances: UnityInstance[]) => void
): fs.FSWatcher {
    fs.mkdirSync(DISCOVERY_DIR, { recursive: true });

    return fs.watch(DISCOVERY_DIR, () => {
        // Debounce — file writes may trigger multiple events
        setTimeout(() => {
            onChange(discoverUnityInstances());
        }, 500);
    });
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);  // signal 0 = check if process exists
        return true;
    } catch {
        return false;
    }
}
```

#### Rewrite: `src/agent/UnityConnection/UnityManager.ts`

The manager becomes a **client** that connects to Unity servers.

Key changes:

- Remove the WebSocket server (`wss`) setup
- Remove `handleConnection()` — the extension initiates connections now
- Add `connectToProject(projectPath)` — discovers the Unity instance and connects
- Keep `sendAndWait()` — same API, just sends over the client WebSocket
- Keep heartbeat, message routing, command correlation — all the same concepts
- Watch the discovery directory for new Unity instances appearing

```typescript
export class UnityManager {
    private _targetProjectPath?: string;
    private _ws?: WebSocket;  // client WebSocket to Unity
    private _discoveryWatcher?: fs.FSWatcher;

    /**
     * Set target project and connect to it.
     */
    async setTargetProject(projectPath: string): Promise<void> {
        this._targetProjectPath = projectPath;

        // Look for a running Unity instance
        const instance = findInstanceForProject(projectPath);
        if (instance) {
            await this._connectTo(instance);
        }
        // If not found, the discovery watcher will connect when Unity starts
    }

    /**
     * Start watching for Unity instances.
     */
    startDiscovery(): void {
        this._discoveryWatcher = watchInstances((instances) => {
            // If we have a target and a matching instance just appeared, connect
            if (this._targetProjectPath && !this._ws) {
                const match = instances.find(i =>
                    this._pathsMatch(i.projectPath, this._targetProjectPath!)
                );
                if (match) {
                    this._connectTo(match);
                }
            }
        });
    }

    /**
     * Connect to a specific Unity instance.
     */
    private async _connectTo(instance: UnityInstance): Promise<void> {
        // Close existing connection if any
        this._ws?.close();

        this._ws = new WebSocket(instance.wsUrl);

        this._ws.on('open', () => {
            // Connected — send hello, start heartbeat
        });

        this._ws.on('message', (data) => {
            // Same message handling as before
        });

        this._ws.on('close', () => {
            this._ws = undefined;
            // Notify disconnected
            // Watch for reconnection via discovery watcher
        });
    }

    // sendAndWait(), isConnected, etc. stay the same API
}
```

### Remove: WebSocket Server Setup

In `extension.ts` or `agent-service.ts`, remove the `wss` (WebSocket.Server) creation. The extension no longer runs a server. Instead:

```typescript
// OLD: start server, wait for Unity to connect
this.startWebSocketServer();

// NEW: start discovery, connect to Unity when found
this.unityManager.startDiscovery();
this.unityManager.setTargetProject(selectedProjectPath);
```

---

## Migration Checklist

### Unity Package

- [ ] Create `Editor/WebSocketServer.cs` — HttpListener-based WebSocket server
- [ ] Move message queue and main-thread dispatch from `WebSocketClient.cs` to `WebSocketServer.cs`
- [ ] Discovery file write on startup (`~/.movesia/instances/{pid}.json`)
- [ ] Discovery file cleanup on quit
- [ ] Domain reload handling (stop/restart server, preserve port via SessionState)
- [ ] Update `MessageHandler.cs` — change `WebSocketClient.Send()` calls to `WebSocketServer.Send()`
- [ ] Heartbeat handling (respond to pings from extension)
- [ ] Remove `WebSocketClient.cs` (no longer needed)
- [ ] Remove vendored NativeWebSocket `Editor/WebSocket/` (no longer needed — using System.Net.WebSockets directly)
- [ ] Test: single Unity project
- [ ] Test: two Unity projects simultaneously
- [ ] Test: domain reload (script compilation)
- [ ] Test: Unity crash recovery (stale discovery file cleanup)

### Extension

- [ ] Create `src/agent/UnityConnection/UnityDiscovery.ts` — discovery file scanning + watcher
- [ ] Rewrite `UnityManager.ts` — client mode, connects to Unity servers
- [ ] Remove WebSocket server setup from `extension.ts` / `agent-service.ts`
- [ ] Keep: heartbeat logic (now extension sends pings)
- [ ] Keep: message routing, command correlation, compilation handling
- [ ] Keep: `sendAndWait()` public API (tools don't need to change)
- [ ] Update `agent-service.ts` — replace `startWebSocketServer()` with `startDiscovery()`
- [ ] Test: extension connects to correct Unity instance
- [ ] Test: switching target project connects to different Unity
- [ ] Test: Unity starts after extension (discovery watcher picks it up)
- [ ] Test: Unity closes and reopens (extension reconnects)

### What Doesn't Change

- `src/agent/unity-tools/` — all tool implementations stay identical (they call `sendAndWait`)
- `src/agent/unity-tools/types.ts` — `UnityManagerInterface` stays the same
- `MessageHandler.cs` — same message handling logic, just different transport
- `src/agent/UnityConnection/types.ts` — message types, close codes, configs stay
- `src/agent/UnityConnection/router.ts` — message routing stays
- `src/agent/UnityConnection/heartbeat.ts` — heartbeat logic stays (direction flips)

---

## Benefits Over Current Option B

| Aspect | Option B (current) | Option A |
|--------|-------------------|----------|
| Who initiates | Unity clients poll for server | Extension connects when needed |
| Idle connections | All Unity instances connected | Only target connected |
| Discovery | Unity must know server port | File-based discovery |
| Server dependency | Extension must be running first | Unity can start independently |
| Port conflicts | Single port for all | Each Unity gets its own port |
| Scaling | All connections on one port | Independent servers |
| Switching projects | Instant (already connected) | Near-instant (connect to discovered instance) |
| Network overhead | N idle WebSocket connections | 1 active connection |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| HttpListener requires permissions on some OS | Use `127.0.0.1` (loopback) — no admin required |
| Discovery file not cleaned up on crash | Extension checks if PID is alive before connecting |
| Port changes after domain reload | Store port in `SessionState`, try to reuse; update discovery file if changed |
| File watcher misses events | Periodic scan (every 10s) as fallback alongside fs.watch |
| Multiple extensions connecting to same Unity | Unity server accepts one client, supersedes old |
