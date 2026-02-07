# Implementation Guide: Project-Scoped WebSocket Connection

## Goal

**Stop the WebSocket server from accepting any Unity instance blindly.** Instead, make the connection project-aware: the server only starts after a project is selected, and it rejects connections from Unity instances that don't match the selected project.

### Current Behavior (broken)

```
Extension activates
  -> WebSocket server starts immediately on :8765
  -> ANY Unity editor running the Movesia package connects
  -> User picks a project later (but the wrong Unity might already be connected)
```

### Target Behavior (fixed)

```
Extension activates
  -> Database, agent, UnityManager created (NO WebSocket server yet)
  -> User selects a project (or saved project is restored)
  -> WebSocket server starts with a "target project path"
  -> Unity connects and sends its projectPath in the URL
  -> Server compares paths:
       Match    -> accept connection
       Mismatch -> reject with close code 4006
  -> User switches project -> old connection closed, server waits for correct Unity
```

---

## Files to Change (4 files)

| File | What Changes |
|------|--------------|
| `src/services/agent-service.ts` | Defer WS server start; extract `projectPath` from URL; add `setTargetProject()` and `stopWebSocketServer()` |
| `src/agent/UnityConnection/UnityManager.ts` | Add `targetProjectPath` field; validate project on connection; add `setTargetProject()` and `disconnectIfMismatch()` |
| `src/agent/UnityConnection/types.ts` | Add new close code `PROJECT_MISMATCH: 4006` |
| `src/extension.ts` | Wire `setSelectedProject` to trigger WS server start via the new flow |

---

## Change 1: `src/agent/UnityConnection/types.ts`

**Add one close code.** In the `CloseCode` constant object (~line 331), add:

```typescript
// Existing codes...
COMPILATION_RESET: 4005,

// ADD THIS:
PROJECT_MISMATCH: 4006,             // Connection rejected: wrong Unity project
```

That's the only change to this file.

---

## Change 2: `src/agent/UnityConnection/UnityManager.ts`

### 2a. Add a `_targetProjectPath` field

In the class properties (~line 91, alongside `_currentSession`), add:

```typescript
private _targetProjectPath?: string;
```

### 2b. Add `setTargetProject()` public method

Add this method to the **Public API** section (after `closeAll()`, ~line 346):

```typescript
/**
 * Set the target project path.
 * Only Unity instances matching this path will be accepted.
 * If a current connection exists and doesn't match, it will be disconnected.
 */
setTargetProject(projectPath: string): void {
    this._targetProjectPath = projectPath;
    logger.info(`Target project set: ${projectPath}`);

    // If there's a current connection that doesn't match, disconnect it
    this.disconnectIfMismatch();
}

/**
 * Get the current target project path.
 */
get targetProjectPath(): string | undefined {
    return this._targetProjectPath;
}
```

### 2c. Add `disconnectIfMismatch()` public method

Add right after `setTargetProject()`:

```typescript
/**
 * Disconnect the current Unity connection if its project path
 * doesn't match the target project path.
 */
disconnectIfMismatch(): void {
    if (!this._targetProjectPath || !this._currentConnection || !this._currentWs) {
        return;
    }

    const connectedProject = this._currentConnection.projectPath;

    if (connectedProject && !this._pathsMatch(connectedProject, this._targetProjectPath)) {
        logger.info(
            `Disconnecting mismatched project: connected="${connectedProject}", target="${this._targetProjectPath}"`
        );
        try {
            this._currentWs.close(CloseCode.PROJECT_MISMATCH, 'project mismatch');
        } catch (error) {
            logger.debug(`Error closing mismatched connection: ${error}`);
        }
    }
}
```

### 2d. Add `_pathsMatch()` private helper

Add to the **Private Implementation** section (near `_generateCid()`):

```typescript
/**
 * Compare two file paths for equality, normalizing separators and case on Windows.
 */
private _pathsMatch(a: string, b: string): boolean {
    const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return normalize(a) === normalize(b);
}
```

> **Why normalize?** Unity on Windows sends paths with forward slashes (`C:/Users/...`) but VS Code/Node might use backslashes (`C:\Users\...`). The paths also need case-insensitive comparison on Windows.

### 2e. Modify `handleConnection()` to validate project path

Change the method signature (~line 149) to accept `projectPath`:

```typescript
async handleConnection(
    websocket: WebSocket,
    providedSessionId?: string,
    connSeq: number = 0,
    projectPath?: string          // <-- ADD THIS PARAMETER
): Promise<void> {
```

Then, **right after** the `const cid = this._generateCid();` line (~line 155), add this validation block:

```typescript
// ── Project path validation ──
// If we have a target project and the connecting Unity sent a project path,
// reject if they don't match.
if (this._targetProjectPath && projectPath) {
    if (!this._pathsMatch(projectPath, this._targetProjectPath)) {
        logger.info(
            `Rejecting connection [${cid}]: project mismatch ` +
            `(incoming="${projectPath}", target="${this._targetProjectPath}")`
        );
        websocket.close(CloseCode.PROJECT_MISMATCH, 'project mismatch');
        return;
    }
}
```

Then, when creating the connection metadata (~line 161), pass `projectPath` through:

```typescript
const connection = createExtendedConnection(cid, {
    session: sessionId,
    connSeq,
    projectPath     // <-- ADD THIS
});
```

And when calling `this._sessions.accept()` (~line 167), pass `projectPath`:

```typescript
const decision = await this._sessions.accept(
    sessionId,
    connSeq,
    connection,
    websocket,
    projectPath     // <-- ADD THIS (the UnitySessionManager.accept() already accepts this param)
);
```

---

## Change 3: `src/services/agent-service.ts`

This is the biggest change. Three things need to happen:

1. **Don't start the WS server in `initialize()`**
2. **Extract `projectPath` from the URL when Unity connects**
3. **Expose methods to start/stop the WS server on demand**

### 3a. Remove the automatic WS server start from `initialize()`

In the `initialize()` method (~line 355-356), **remove or comment out** this line:

```typescript
// DELETE THIS LINE:
await this.startWebSocketServer()
```

The `initialize()` method should still create the `unityManager` and the agent — just not start the WebSocket server.

### 3b. Extract `projectPath` from URL in `startWebSocketServer()`

In the `connection` event handler inside `startWebSocketServer()` (~line 391-403), extract the `projectPath` query param and pass it to `handleConnection`:

Replace the existing connection handler:

```typescript
this.wsServer.on('connection', async (ws: WebSocket, req) => {
    this.log(`🎮 Unity connection from ${req.socket.remoteAddress}`)

    // Parse session ID, connection sequence, and project path from URL
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    const sessionId = url.searchParams.get('session') ?? undefined
    const connSeq = parseInt(
        url.searchParams.get('conn') ?? url.searchParams.get('conn_seq') ?? '0',
        10
    )
    const projectPath = url.searchParams.get('projectPath')
        ? decodeURIComponent(url.searchParams.get('projectPath')!)
        : undefined

    this.log(`🔗 Connection params: session=${sessionId?.slice(0, 8)}..., connSeq=${connSeq}, projectPath=${projectPath ?? 'none'}`)

    // Hand off to Unity manager (which will validate the project path)
    if (this.unityManager) {
        await this.unityManager.handleConnection(ws, sessionId, connSeq, projectPath)
    }
})
```

### 3c. Make `startWebSocketServer()` safe to call multiple times

Add a guard at the top of `startWebSocketServer()`:

```typescript
private async startWebSocketServer(): Promise<void> {
    // Don't start if already running
    if (this.wsServer) {
        this.log('WebSocket server already running')
        return
    }

    const port = this.config.wsPort ?? 8765
    // ... rest of existing code
}
```

### 3d. Add `stopWebSocketServer()` method

Add this new method right after `startWebSocketServer()`:

```typescript
/**
 * Stop the WebSocket server and disconnect all Unity connections.
 */
private async stopWebSocketServer(): Promise<void> {
    if (!this.wsServer) {
        return
    }

    this.log('Stopping WebSocket server...')

    // Close all Unity connections first
    if (this.unityManager) {
        await this.unityManager.closeAll()
    }

    // Close the server
    return new Promise((resolve) => {
        this.wsServer!.close(() => {
            this.log('WebSocket server stopped')
            this.wsServer = null
            resolve()
        })
    })
}
```

### 3e. Modify `setProjectPath()` to start the WS server and set target project

Replace the existing `setProjectPath()` method (~line 648-662) with:

```typescript
async setProjectPath(newPath: string): Promise<void> {
    const previousPath = this.config.projectPath
    logger.info(
        `Setting project path: ${newPath} (previous: ${previousPath || 'none'})`
    )

    this.config.projectPath = newPath
    process.env.UNITY_PROJECT_PATH = newPath

    // Update the agent's project path
    const { setUnityProjectPath } = await import('../agent/agent')
    setUnityProjectPath(newPath)

    // Set target project on UnityManager (disconnects wrong Unity if connected)
    if (this.unityManager) {
        this.unityManager.setTargetProject(newPath)
    }

    // Start WebSocket server if not already running
    // (first project selection triggers the server)
    if (!this.wsServer) {
        this.log('Project selected — starting WebSocket server...')
        await this.startWebSocketServer()
    }

    logger.info(`Project path updated successfully to: ${newPath}`)
}
```

### 3f. (Optional) Add `clearProjectPath()` for when user clears their selection

```typescript
/**
 * Clear the project path and stop the WebSocket server.
 * Called when user clears their project selection.
 */
async clearProjectPath(): Promise<void> {
    logger.info('Clearing project path')

    this.config.projectPath = undefined
    delete process.env.UNITY_PROJECT_PATH

    const { setUnityProjectPath } = await import('../agent/agent')
    setUnityProjectPath('')

    // Stop WebSocket server — no project means no reason to accept connections
    await this.stopWebSocketServer()

    logger.info('Project path cleared, WebSocket server stopped')
}
```

---

## Change 4: `src/extension.ts`

### 4a. Update `setSelectedProject` message handler

The current handler (~line 233-245) already calls `agentService.setProjectPath()`, which with the changes above will now trigger the WS server start and target project filtering. **No change needed here** — the existing code already does the right thing once `setProjectPath()` is updated.

### 4b. Update `clearSelectedProject` message handler

In the `clearSelectedProject` case (~line 254-258), call `clearProjectPath()` if you added it:

```typescript
case 'clearSelectedProject': {
    await context.workspaceState.update(SELECTED_PROJECT_KEY, undefined)
    if (agentService) {
        await agentService.clearProjectPath()
    }
    postMessage({ type: 'selectedProject', projectPath: null })
    break
}
```

### 4c. Update `initializeAgentService()`

The saved project restoration (~line 120-123) already calls `agentService.setProjectPath()`, which will now trigger the WS server start. **No change needed** — the flow naturally works:

1. Extension activates
2. `initializeAgentService()` runs
3. `agentService.initialize()` creates UnityManager + agent but **no WS server**
4. If saved project exists → `agentService.setProjectPath(savedProjectPath)` → **WS server starts now**
5. If no saved project → WS server stays off until user selects one

---

## Path Normalization: Why It Matters

Unity on Windows sends paths like:
```
C:/Users/jimen/MyGame
```

VS Code / Node.js might store:
```
C:\Users\jimen\MyGame
```

The `_pathsMatch()` helper normalizes both to `c:/users/jimen/mygame` before comparing. Without this, connections would always be rejected on Windows even when the project is correct.

---

## What Happens at Runtime

### Scenario 1: Fresh start, user selects project

```
1. Extension activates
2. Agent + UnityManager created (no WS server)
3. User opens webview -> projectSelector
4. User clicks "MyGame"
5. setSelectedProject message -> agentService.setProjectPath("C:/Users/jimen/MyGame")
6. UnityManager.setTargetProject("C:/Users/jimen/MyGame")
7. WebSocket server starts on :8765
8. Unity Editor (MyGame) connects: ws://localhost:8765?...&projectPath=C:/Users/jimen/MyGame
9. Paths match -> connection accepted
```

### Scenario 2: Two Unity editors running

```
1. Target project: "C:/Users/jimen/MyGame"
2. WS server running on :8765

Unity A (MyGame) connects with projectPath=C:/Users/jimen/MyGame
  -> Paths match -> ACCEPTED

Unity B (OtherProject) connects with projectPath=C:/Users/jimen/OtherProject
  -> Paths don't match -> REJECTED (close code 4006)
```

### Scenario 3: User switches project

```
1. Currently connected to MyGame
2. User selects "OtherProject" in projectSelector
3. agentService.setProjectPath("C:/Users/jimen/OtherProject")
4. UnityManager.setTargetProject("C:/Users/jimen/OtherProject")
5. UnityManager.disconnectIfMismatch()
   -> Current connection is MyGame, target is OtherProject -> DISCONNECT (4006)
6. WS server stays running, waiting for OtherProject's Unity to connect
7. Unity Editor (OtherProject) connects -> paths match -> ACCEPTED
```

### Scenario 4: Returning user with saved project

```
1. Extension activates
2. Saved project found: "C:/Users/jimen/MyGame"
3. agentService.setProjectPath("C:/Users/jimen/MyGame") during init
4. WS server starts, target = MyGame
5. If Unity (MyGame) is running, it connects and matches -> ACCEPTED
```

---

## Unity-Side Change (Already Done)

For reference, the Unity `WebSocketClient.cs` line 88 was changed from:

```csharp
var url = $"{WS_URL}?session={SessionId}&conn={mySeq}";
```

To:

```csharp
var projectPath = Application.dataPath.Replace("/Assets", "").Replace("\\Assets", "");
var url = $"{WS_URL}?session={SessionId}&conn={mySeq}&projectPath={Uri.EscapeDataString(projectPath)}";
```

---

## Summary Checklist

- [ ] `types.ts` — Add `PROJECT_MISMATCH: 4006` to `CloseCode`
- [ ] `UnityManager.ts` — Add `_targetProjectPath` field
- [ ] `UnityManager.ts` — Add `setTargetProject()` method
- [ ] `UnityManager.ts` — Add `disconnectIfMismatch()` method
- [ ] `UnityManager.ts` — Add `_pathsMatch()` helper
- [ ] `UnityManager.ts` — Modify `handleConnection()` to accept and validate `projectPath`
- [ ] `UnityManager.ts` — Pass `projectPath` to `createExtendedConnection()` and `_sessions.accept()`
- [ ] `agent-service.ts` — Remove `await this.startWebSocketServer()` from `initialize()`
- [ ] `agent-service.ts` — Add guard to `startWebSocketServer()` to prevent double-start
- [ ] `agent-service.ts` — Extract and decode `projectPath` from URL in connection handler
- [ ] `agent-service.ts` — Add `stopWebSocketServer()` method
- [ ] `agent-service.ts` — Update `setProjectPath()` to call `setTargetProject()` and start WS server
- [ ] `agent-service.ts` — (Optional) Add `clearProjectPath()` method
- [ ] `extension.ts` — (Optional) Update `clearSelectedProject` to call `clearProjectPath()`
