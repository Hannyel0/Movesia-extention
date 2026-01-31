# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Movesia Extension is a VS Code extension with a Python backend agent for Unity Editor integration. It combines React 19 webviews running inside VS Code with a LangGraph agent server that communicates with Unity via WebSocket.

## Build Commands

```bash
# TypeScript extension compilation
npm run compile        # Build once
npm run watch          # Watch mode (parallel tsc + vite)

# Webview bundling (React/Vite)
npm run dev            # Build webviews only

# Code quality
npm run lint           # ESLint
npm run format         # Prettier
```

**Development workflow**: Use VS Code's built-in "Run and Debug" (F5) which executes both `tsc watch` and `vite build` in parallel via `.vscode/tasks.json`.

**Python agent** (in `agent/` directory):
```bash
cd agent/
python server.py
```

## Architecture

### Two-Part System

1. **VS Code Extension** (TypeScript/React 19) - UI layer with chat interface
2. **Python Agent Server** (LangGraph/FastAPI) - AI + Unity communication

---

## Extension Architecture

### Entry Point

**File**: `src/extension.ts`

Registers two commands:
- `NextWebview1.start` → Opens "Movesia AI Chat" (`chatView` route) - primary interface
- `NextWebview2.start` → Opens "View 2" (`view2` route) - Zustand demo

### Webview Management

**File**: `src/NextWebview.ts`

- **`NextWebviewPanel`**: Singleton pattern for floating panels. One instance per `viewId`.
- **`NextWebviewSidebar`**: Implements `vscode.WebviewViewProvider` for sidebar views.
- **HTML Generation**: Injects nonce for CSP, `data-route` attribute for React router.
- **Output paths**: `out/webviews/index.mjs` and `out/webviews/style.css`

### React Application

**Entry**: `src/webviews/src/index.tsx`

- **Router**: `MemoryRouter` (not browser history - required for webviews)
- **Routes**:
  - `/chatView` → `<ChatView />` - Main chat interface
  - `/view2` → `<View2 />` - Zustand state demo
- **Route detection**: Reads `data-route` from root element, navigates on mount

### State Management

Two patterns available:

1. **VS Code State Hook** (`lib/state/reactState.tsx`):
   ```tsx
   const [messages, setMessages] = useVSCodeState<Message[]>([], 'chatMessages')
   ```
   Persists to VS Code's storage API.

2. **Zustand Store** (`lib/state/zustandState.tsx`):
   ```tsx
   const useAppState = createVSCodeZustand('myAppState', (set) => ({ ... }))
   ```
   Wraps Zustand with VS Code persistence backend.

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `ChatView` | `ChatView.tsx` | Main chat interface with message history |
| `ChatInput` | `lib/components/ChatInput.tsx` | Input bar with action buttons |
| `MarkdownRenderer` | `lib/components/MarkdownRenderer.tsx` | GFM + syntax highlighting (C# support) |
| `ThreadSelector` | `lib/components/ThreadSelector.tsx` | Dropdown for managing conversation threads |
| `UnityStatusIndicator` | `lib/components/UnityStatusIndicator.tsx` | Unity connection status with logo + colored dot |
| `FieldWithDescription` | `lib/components/FieldWithDescription.tsx` | Settings field wrapper |
| `Toggle` | `lib/components/Toggle.tsx` | Checkbox with label |
| UI primitives | `lib/components/ui/` | Button, Avatar, Input, ScrollArea, DropdownMenu, Collapsible (Radix-based) |

### Pluggable Tool UI System

Located in `lib/components/tools/`. Provides extensible rendering for agent tool calls.

**Architecture**:
- `types.ts` - Core interfaces (`ToolUIProps`, `ToolCallData`, `ToolCallState`)
- `registry.ts` - Tool registration and lookup
- `DefaultToolUI.tsx` - Fallback JSON display for unregistered tools
- `ToolUIWrapper.tsx` - Collapsible wrapper with header/status
- `custom/` - Custom tool UI implementations

**Registering a custom tool UI**:
```tsx
import { registerToolUI } from './tools'

registerToolUI('my_tool', {
  config: { displayName: 'My Tool', color: 'text-pink-400' },
  component: MyToolComponent,
})
```

**Built-in custom UIs**: `UnityQueryUI`, `UnityHierarchyUI`, `UnityRefreshUI`

### Custom Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useToolCalls` | `lib/hooks/useToolCalls.ts` | Tracks tool call state through streaming lifecycle |
| `useThreads` | `lib/hooks/useThreads.ts` | Thread/conversation management with backend persistence |
| `useUnityStatus` | `lib/hooks/useUnityStatus.ts` | Polls Unity connection status from backend |
| `useVSCodeState` | `lib/state/reactState.tsx` | Persists state to VS Code storage API |

### Chat Interface Features

- Auto-scrolling message container
- Memoized `ChatMessage` component (prevents re-renders during typing)
- Empty state with suggestion buttons
- Loading state with spinner
- Markdown rendering with Prism syntax highlighting
- Code blocks with language label and copy button
- Interleaved tool call rendering (tools appear inline with text at correct positions)
- Thread management (create, select, delete conversations)
- Unity connection status indicator (green/yellow/red)

---

## Agent Architecture

### Server

**File**: `agent/server.py`

FastAPI server with global managers:
- `interrupt_manager` - Async interrupt handling (compilation waits)
- `chat_manager` - VS Code session tracking
- `unity_manager` - Unity WebSocket management
- `agent_streamer` - LangGraph execution streaming

**Endpoints**:
```
GET  /health                              → {"status": "healthy", "unity_connected": bool}
GET  /status                              → Full server/Unity/chat status
GET  /unity/status                        → Unity connection state for UI indicator
POST /api/chat                            → SSE streaming chat endpoint
GET  /api/conversations                   → List all conversations
GET  /api/conversations/{id}              → Get conversation details
GET  /api/conversations/{id}/messages     → Get conversation messages with tool calls
DELETE /api/conversations/{id}            → Delete conversation
WS   /ws/chat/{session_id}                → VS Code chat connection (legacy)
WS   /ws/unity                            → Unity Editor connection
```

### Agent Setup

**File**: `agent/agent.py`

```python
model = ChatOpenAI(
    model="x-ai/grok-code-fast-1",
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)
```

**Middleware**:
- `OptimizedTodoMiddleware` - Token-optimized task lists
- `FilesystemMiddleware` - Routes file ops to Unity project

**Backend Routing**:
- `/memories/` → `StoreBackend` (persistent across threads)
- `/scratch/` → `StateBackend` (ephemeral, thread-specific)
- Everything else → `FilesystemBackend` (Unity project at `UNITY_PROJECT_PATH`)

### Streaming

**File**: `agent/streaming.py`

`AgentStreamer` handles:
- Real-time token streaming to VS Code
- Tool start/end/error events
- LangGraph interrupt detection and resumption
- Waiting messages during Unity operations

**Chat WebSocket Message Types**:
```
connected       → Initial connection
thinking        → Agent started
token           → LLM streaming chunk
tool_start      → Tool execution began (includes textLengthAtEvent for position)
tool_input      → Tool input captured
tool_output     → Tool result received
tool_error      → Tool failed
waiting         → Waiting on interrupt
interrupt_resolved → Interrupt completed
complete        → Agent finished
error           → Error occurred
```

**Tool Call Lifecycle**:
1. `tool_start` → state: `streaming` (captures text position)
2. `tool_input` → state: `executing` (input available)
3. `tool_output` → state: `completed` (output available)
4. `tool_error` → state: `error`

### Unity Connection

**File**: `agent/unity/unity_manager.py`

- Single active connection per project (monotonic takeover)
- Handshake with project path, Unity version, session ID
- Heartbeat with compilation-aware suspension
- Command/response correlation for tool calls

---

## Unity Tools (6 Tools)

Located in `agent/unity_tools/`. All target **Unity 6** (6000.x) API.

### 1. unity_query (The Observer) - Read-Only

| Action | Params | Returns |
|--------|--------|---------|
| `hierarchy` | `max_depth` (default: 5) | Scene tree with instance IDs |
| `inspect_object` | `instance_id` | All components and properties |
| `search_assets` | `search_query`, `asset_type` | Matching prefabs/scripts/assets |
| `get_logs` | `log_filter` (Error/Warning/Exception) | Filtered console logs |
| `get_settings` | `settings_category` | Physics/player/quality settings |

### 2. unity_hierarchy (The Architect) - Scene Graph

| Action | Params | Effect |
|--------|--------|--------|
| `create` | `name`, `primitive_type`, `parent_id`, `position` | New GameObject |
| `duplicate` | `instance_id` | Clone existing |
| `destroy` | `instance_id` | Remove (Undo supported) |
| `rename` | `instance_id`, `name` | Change name |
| `reparent` | `instance_id`, `parent_id` | Move in hierarchy |
| `move_scene` | `instance_id`, `target_scene` | Move between scenes |

### 3. unity_component (The Engineer) - Behavior/Data

| Action | Params | Effect |
|--------|--------|--------|
| `add` | `game_object_id`, `component_type` | Attach component |
| `modify` | `properties`, `game_object_id` + `component_type` | Change properties |
| `remove` | `game_object_id` + `component_type` | Delete component |

**Property format**: Vectors use arrays `[x, y, z]`, not objects.
```python
properties={'m_LocalPosition': [0, 5, 0]}  # Correct
```

### 4. unity_prefab (The Factory) - Templates

| Action | Params | Effect |
|--------|--------|--------|
| `instantiate` | `asset_path`, `position`, `rotation` | Spawn by path |
| `instantiate_by_name` | `prefab_name`, `position`, `rotation` | Search and spawn |
| `create_asset` | `instance_id`, `asset_path` | Create prefab from scene |
| `modify_asset` | `asset_path`, `component_type`, `properties` | Edit .prefab file |
| `apply` | `instance_id` | Push scene changes to asset |
| `revert` | `instance_id` | Reset to asset state |

### 5. unity_scene (The Director) - Environment

| Action | Params | Effect |
|--------|--------|--------|
| `open` | `path`, `additive` | Load scene |
| `save` | `path` (optional) | Save current/new path |
| `create` | `path` (must end .unity), `additive` | Create new scene |
| `set_active` | `path` | Set active scene (must be loaded) |

### 6. unity_refresh (The Compiler) - Script Compilation

Triggers Unity Asset Database refresh. Uses LangGraph `interrupt()` to pause agent.

```python
unity_refresh(watched_scripts=['PlayerController'])
# Wait for Unity compilation...
# Returns: {"status": "SUCCESS", "verification": {"PlayerController": true}}
```

**Critical workflow**: Always refresh after creating scripts before adding components.

---

## Directory Structure

```
src/
├── extension.ts              # Extension activation, command registration
├── NextWebview.ts            # Webview panel/sidebar base classes
└── webviews/
    ├── src/
    │   ├── index.tsx         # React entry, MemoryRouter setup
    │   ├── ChatView.tsx      # Main chat interface
    │   ├── View2.tsx         # Zustand demo view
    │   ├── testMessages.ts   # Markdown test data
    │   └── lib/
    │       ├── components/   # UI components
    │       │   ├── ChatInput.tsx
    │       │   ├── MarkdownRenderer.tsx
    │       │   ├── ThreadSelector.tsx
    │       │   ├── UnityStatusIndicator.tsx
    │       │   ├── FieldWithDescription.tsx
    │       │   ├── Toggle.tsx
    │       │   ├── tools/    # Pluggable tool UI system
    │       │   │   ├── index.ts          # Public exports
    │       │   │   ├── types.ts          # ToolCallData, ToolUIProps interfaces
    │       │   │   ├── registry.ts       # Tool registration/lookup
    │       │   │   ├── DefaultToolUI.tsx # Fallback JSON display
    │       │   │   ├── ToolUIWrapper.tsx # Collapsible wrapper
    │       │   │   └── custom/           # Unity tool UIs
    │       │   └── ui/       # Radix-based primitives
    │       ├── hooks/
    │       │   ├── useToolCalls.ts   # Tool call state management
    │       │   ├── useThreads.ts     # Conversation thread management
    │       │   └── useUnityStatus.ts # Unity connection polling
    │       ├── streaming/
    │       │   └── sseParser.ts      # SSE stream parsing for AI SDK
    │       ├── types/
    │       │   └── chat.ts           # DisplayMessage, ToolCallEvent types
    │       ├── utils/
    │       │   └── messageSegments.ts # Interleaved text/tool rendering
    │       ├── state/
    │       │   ├── reactState.tsx    # useVSCodeState hook
    │       │   └── zustandState.tsx  # Zustand + VS Code storage
    │       ├── VSCodeAPI.tsx # VS Code API wrapper
    │       ├── utils.ts      # cn() utility for classnames
    │       └── vscode.css    # Tailwind entry + VS Code variables
    └── public/               # Static assets

agent/
├── server.py                 # FastAPI entry, global managers
├── agent.py                  # LangGraph agent, model config, middleware
├── streaming.py              # AgentStreamer, event handling, interrupts
├── prompts.py                # System prompts (Unity 6 API)
├── managers/
│   ├── interrupt_manager.py  # Async interrupt coordination
│   └── chat_manager.py       # Session tracking
├── routes/
│   └── chat_ws.py            # Chat WebSocket handler
├── unity/
│   ├── unity_ws.py           # Unity WebSocket endpoint
│   ├── unity_manager.py      # Connection lifecycle, command routing
│   ├── config.py             # Configuration classes
│   └── types.py              # MovesiaMessage envelope
└── unity_tools/
    ├── connection.py         # HTTP middleware bridge (port 8766)
    ├── query.py              # unity_query tool
    ├── hierarchy.py          # unity_hierarchy tool
    ├── component.py          # unity_component tool
    ├── prefab.py             # unity_prefab tool
    ├── scene.py              # unity_scene tool
    └── refresh.py            # unity_refresh tool (with interrupt)
```

## Configuration

### Build Configuration

- **TypeScript**: `tsconfig.json` - ES2020 target, outputs to `out/`, excludes webviews
- **Vite**: `vite.config.mjs` - React plugin, library output to `out/webviews/index.mjs`
- **Tailwind**: `tailwind.config.js` - VS Code theme colors via `@githubocto/tailwind-vscode`
- **PostCSS**: `postcss.config.cjs` - Tailwind + nesting plugin

### Agent Environment

**File**: `agent/.env`

```bash
# Required
OPENROUTER_API_KEY=sk-or-v1-...
TAVILY_API_KEY=tvly-dev-...
UNITY_PROJECT_PATH=C:/path/to/unity/project

# Optional
SERVER_HOST=127.0.0.1
SERVER_PORT=8765
LOG_LEVEL=INFO
UNITY_COMMAND_TIMEOUT=30.0
INTERRUPT_TIMEOUT=120.0

# LangSmith tracing (optional)
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_PROJECT=your-project
```

### Port Requirements

- **8765**: FastAPI server (HTTP + WebSocket)
- **8766**: Unity middleware (HTTP - tool communication)

## Key Patterns

- **Singleton webviews**: One panel instance per route via static `instances` map
- **Message passing**: Extension ↔ Webview via `postMessage` API
- **Interrupt/checkpoint**: Agent pauses for async Unity ops (compilation), resumes with result
- **Dual build**: TypeScript (tsc) + Vite run in parallel via `.vscode/tasks.json`
- **VS Code theme integration**: Tailwind classes map to CSS variables (`bg-vscode-editor-background`)
- **Monotonic takeover**: Higher `conn_seq` supersedes older Unity connections
- **Tool HTTP bridge**: Unity tools use HTTP (port 8766), not WebSocket, for sync calls
- **Interleaved tool rendering**: Tool calls appear inline with text at their invocation position using `textLengthAtEvent` markers
- **SSE streaming**: Chat uses HTTP POST with SSE response (not WebSocket) via Vercel AI SDK v6 custom transport
- **Pluggable tool UIs**: Register custom React components per tool name for rich rendering

## Dependencies

### Extension (package.json)

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 19.2.4 | UI framework with automatic JSX transform |
| `react-router-dom` | 6.30.3 | MemoryRouter for webview routing |
| `@ai-sdk/react` | latest | Vercel AI SDK v6 `useChat` hook |
| `ai` | latest | AI SDK core types (`UIMessage`) |
| `zustand` | 5.0.10 | Lightweight state management |
| `react-markdown` | 10.1.0 | Markdown parsing |
| `remark-gfm` | 4.0.1 | GitHub Flavored Markdown |
| `prism-react-renderer` | 2.4.1 | Syntax highlighting (C# support) |
| `@radix-ui/*` | various | Accessible UI primitives |
| `lucide-react` | 0.563.0 | Icon library |
| `tailwindcss` | 3.4.19 | Utility CSS framework |
| `class-variance-authority` | 0.7.1 | Component variant styling |

### Agent (requirements.txt)

- `fastapi` + `uvicorn` - HTTP/WebSocket server
- `langgraph` - Agent framework
- `langchain-openai` - LLM integration
- `httpx` - HTTP client for Unity middleware
- `python-dotenv` - Environment loading
