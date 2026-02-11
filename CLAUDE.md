# CLAUDE.md

## Project Overview

Movesia Extension is a VS Code extension with an **embedded TypeScript LangGraph agent** for Unity Editor integration. React 19 webviews run inside VS Code, and a LangGraph agent communicates with Unity via WebSocket. Everything runs in a single Node.js process (no separate server).

## Build Commands

```bash
npm run compile        # Build once (tsc with --max-old-space-size=8192)
npm run watch          # Watch mode (tsc only, NOT vite)
npm run dev            # Build webviews only (vite build)
npm run lint           # ESLint
npm run format         # Prettier
```

**Development workflow**: Press F5 in VS Code — `.vscode/tasks.json` runs both `tsc watch` and `vite build` in parallel. The `npm run watch` script only runs tsc.

## Architecture

### Key Files

- `src/extension.ts` — Entry point. Initializes `AgentService`, registers commands (`NextWebview1.start`, `movesia.installUnityPackage`, etc.), routes webview messages.
- `src/services/agent-service.ts` — Bridges webview ↔ LangGraph agent. Uses `UIMessageStreamProtocol` (Vercel AI SDK protocol v1) over `postMessage`. API keys are hardcoded for SaaS deployment.
- `src/NextWebview.ts` — Singleton webview panels. Outputs: `out/webviews/index.js` and `out/webviews/style.css`.
- `src/agent/agent.ts` — LangGraph agent factory. Model: `anthropic/claude-haiku-4.5` via OpenRouter.
- `src/agent/prompts.ts` — System prompt (Unity 6 API focused).

### Webview Routes

`MemoryRouter` in `src/webviews/src/index.tsx`. Default route is `projectSelector`.

| Route | View | Purpose |
|-------|------|---------|
| `/projectSelector` | `ProjectSelector.tsx` | Unity project selection (default) |
| `/installPackage` | `InstallPackage.tsx` | Unity package installation |
| `/chatView` | `ChatView.tsx` | Main chat interface |
| `/view2` | `View2.tsx` | Zustand demo |

### State Management

- **`useChatState`** (`lib/hooks/useChatState.ts`) — Primary chat hook. Custom implementation (no AI SDK dependency). Handles streaming via `postMessage`.
- **`useVSCodeState`** (`lib/state/reactState.tsx`) — Persists state to VS Code storage API.
- **Zustand** (`lib/state/zustandState.tsx`) — `createVSCodeZustand` wraps Zustand with VS Code persistence.

### Streaming Protocol

`AgentService.handleChat()` streams events via callback using `UIMessageStreamProtocol`:

```
start → text-start → text-delta* → text-end → tool-input-start → tool-input-available → tool-output-available → finish-step → finish → done
```

Tool call lifecycle: `tool-input-start` (running) → `tool-input-available` (input shown) → `tool-output-available` (completed) or `error`.

**Tool Input Unwrapping**: LangGraph streamEvents v2 wraps tool args inside `{ input: "<json-string>" }`. The `unwrapToolInput()` function in `agent-service.ts` extracts and parses the inner value so UI components receive actual arguments.

### Unity Connection (Connect-All Architecture)

`src/agent/UnityConnection/` — Modular WebSocket system implementing **Option B (connect-all)**:

- **All Unity instances connect** and stay connected regardless of project
- **Commands route only to the target project** (set via `UnityManager.setTargetProject()`)
- **Non-target connections stay idle** (heartbeats only)
- **Instant project switching** — no reconnection needed when changing targets

Key files:
- `UnityManager.ts` — Main entry point, manages multiple sessions
- `sessions.ts` — Session management with monotonic takeover (newer connSeq wins)
- `heartbeat.ts` — Keepalive with compilation-aware suspension
- `router.ts` — Message routing with ACK support
- `transport.ts` — Low-level WebSocket send/receive
- `config.ts` — Logging and configuration

**WebSocket server starts lazily** when first project is selected (not at extension activation).

### Unity Tools (6 Tools)

All in `src/agent/unity-tools/`, targeting **Unity 6** (6000.x) API:

| Tool | File | Purpose |
|------|------|---------|
| `unity_query` | `query.ts` | Read-only: hierarchy, inspect, search assets, logs, settings |
| `unity_hierarchy` | `hierarchy.ts` | Scene graph: create, duplicate, destroy, rename, reparent |
| `unity_component` | `component.ts` | Components: add, modify, remove. Vectors use arrays `[x,y,z]` |
| `unity_prefab` | `prefab.ts` | Prefabs: instantiate, create/modify asset, apply/revert |
| `unity_scene` | `scene.ts` | Scenes: open, save, create, set_active |
| `unity_refresh` | `refresh.ts` | Triggers AssetDatabase refresh. Uses LangGraph `interrupt()` to pause agent |

**Critical**: Always call `unity_refresh` after creating scripts before adding components.

Tool connection flow: Tools → `callUnityAsync()` (in `connection.ts`) → `UnityManager.sendAndWait()` → WebSocket → Unity

### Persistence

**Single shared sql.js database** for both conversations and LangGraph checkpoints:

- `src/agent/database/engine.ts` — Initializes sql.js, creates single `Database` instance
- `src/agent/database/SqlJsCheckpointer.ts` — LangGraph checkpointer using shared db instance
- `src/agent/database/repository.ts` — `ConversationRepository` for thread CRUD
- **Storage**: VS Code's `globalStorageUri` (e.g., `~/.vscode/data/.../globalStorage/movesia/movesia.db`)

The single instance pattern avoids dual-instance bugs where two in-memory copies would overwrite each other on persist.

### Pluggable Tool UI

`lib/components/tools/` — Register custom React components per tool name:

```tsx
registerToolUI('my_tool', {
  config: { displayName: 'My Tool', color: 'text-pink-400' },
  component: MyToolComponent,
})
```

Registration happens in `registerCustomToolUIs.ts`. Built-in UIs: `UnityQueryUI`, `UnityHierarchyUI`, `UnityRefreshUI`.

## Key Patterns

- **Singleton webviews**: One panel instance per route via static `instances` map
- **Connect-all WebSockets**: Accept all Unity connections, route to target project only
- **Lazy WebSocket server**: Starts when project is selected, not at activation
- **Interrupt/checkpoint**: Agent pauses for async Unity ops (compilation), resumes with result
- **VS Code theme integration**: Tailwind classes map to CSS variables (`bg-vscode-editor-background`)
- **Onboarding flow**: Project selection → Package installation → Chat (route-based navigation)
- **Zod pinned**: `zod` version is pinned to `3.25.67` with overrides for LangChain compatibility
- **Shared db instance**: Single sql.js database shared between checkpointer and conversations

## Common Tasks

### Adding a New Unity Tool

1. Create `src/agent/unity-tools/my-tool.ts` with `StructuredTool` + Zod schema
2. Export in `src/agent/unity-tools/index.ts`, add to `unityTools` array
3. (Optional) Create custom UI in `lib/components/tools/custom/`, register in `registerCustomToolUIs.ts`

### Changing the LLM Model

Edit `src/agent/agent.ts` — change the `modelName` in `createModel()`.

### Customizing System Prompt

Edit `src/agent/prompts.ts` — modify `UNITY_AGENT_PROMPT`.

### Switching Target Unity Project

```typescript
// From extension code
await agentService.setProjectPath('/path/to/unity/project');

// UnityManager routes commands to matching connection automatically
```

## Dependencies

Key packages:
- `@langchain/langgraph` v1.1.3 — Agent framework
- `@langchain/openai` — OpenRouter integration
- `@langchain/tavily` — Optional internet search tool
- `sql.js` v1.13.0 — WASM SQLite for persistence
- `react` v19.2.4 — Webview UI
- `ws` v8.18.0 — WebSocket server
- `zod` v3.25.67 — Schema validation (pinned for LangChain compatibility)

## Troubleshooting

- **Agent not responding**: Check "Movesia Agent" output panel. Verify API key in `agent-service.ts` is valid.
- **Unity tools failing**: Unity Editor must be running with Movesia package installed. Status indicator should be green.
- **Database errors**: Delete the db file in VS Code's globalStorage to reset (loses conversations). Find path via `context.globalStorageUri.fsPath`.
- **Build errors**: Clean with `rm -rf out/ && npm run compile`. Reinstall with `rm -rf node_modules && npm install`.
- **Multi-Unity reconnect loops**: Fixed in current architecture — all Unity instances stay connected, only commands route to target.
- **Tool UI shows raw JSON**: Ensure `unwrapToolInput()` is handling LangGraph's wrapped format correctly.
