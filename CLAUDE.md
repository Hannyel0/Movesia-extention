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

### Unity Connection

`src/agent/UnityConnection/` — Modular WebSocket system. `UnityManager.ts` is the main entry point, supported by `config.ts`, `transport.ts`, `sessions.ts`, `heartbeat.ts`, `router.ts`. WebSocket endpoint at `/ws/unity`. Uses message ID correlation for request/response routing.

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

### Persistence

- `src/agent/database/SqlJsCheckpointer.ts` — Custom LangGraph checkpointer using sql.js (WASM SQLite).
- Storage: `~/.movesia/checkpoints.sqlite`
- `src/agent/database/repository.ts` — `ConversationRepository` and `MessageRepository` for thread CRUD.

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
- **Interrupt/checkpoint**: Agent pauses for async Unity ops (compilation), resumes with result
- **VS Code theme integration**: Tailwind classes map to CSS variables (`bg-vscode-editor-background`)
- **Onboarding flow**: Project selection → Package installation → Chat (route-based navigation)
- **Zod pinned**: `zod` version is pinned to `3.25.67` with overrides for LangChain compatibility

## Common Tasks

### Adding a New Unity Tool

1. Create `src/agent/unity-tools/my-tool.ts` with `StructuredTool` + Zod schema
2. Export in `src/agent/unity-tools/index.ts`, add to `unityTools` array
3. (Optional) Create custom UI in `lib/components/tools/custom/`, register in `registerCustomToolUIs.ts`

### Changing the LLM Model

Edit `src/agent/agent.ts` — change the `modelName` in `createModel()`.

### Customizing System Prompt

Edit `src/agent/prompts.ts` — modify `UNITY_AGENT_PROMPT`.

## Troubleshooting

- **Agent not responding**: Check "Movesia Agent" output panel. Verify API key in `agent-service.ts` is valid.
- **Unity tools failing**: Unity Editor must be running with Movesia package installed. Status indicator should be green.
- **Database errors**: Delete `~/.movesia/checkpoints.sqlite` to reset (loses conversations).
- **Build errors**: Clean with `rm -rf out/ && npm run compile`. Reinstall with `rm -rf node_modules && npm install`.
