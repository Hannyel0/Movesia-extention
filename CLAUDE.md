# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Movesia Extension is a VS Code extension with an **embedded TypeScript LangGraph agent** for Unity Editor integration. It combines React 19 webviews running inside VS Code with a LangGraph agent that communicates with Unity via WebSocket.

**Key Architecture Change**: The agent is now fully embedded in TypeScript (running in the Node.js extension process) with an **sql.js-based checkpointer** for conversation persistence. The Python backend has been deprecated.

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

**No separate agent server needed** - the LangGraph agent runs embedded in the extension process.

## Architecture

### Single-Process System

1. **VS Code Extension** (TypeScript/React 19) - UI layer with chat interface
2. **Embedded LangGraph Agent** (TypeScript) - AI agent running in extension process
3. **Unity WebSocket Connection** - Direct communication with Unity Editor

All components run in the same Node.js process for simplified deployment and debugging.

---

## Extension Architecture

### Entry Point

**File**: `src/extension.ts`

- Initializes `AgentService` immediately on activation (no project path required)
- Registers command `NextWebview1.start` → Opens "Movesia AI Chat" (`chatView` route)
- Handles project selection, package installation, and Unity connection management
- Manages webview message routing for chat, threads, and Unity status

### Agent Service

**File**: `src/services/agent-service.ts`

The `AgentService` class manages the embedded LangGraph agent:

- **Initialization**: Creates agent with `SqlJsCheckpointer` for persistence
- **Streaming**: Converts LangGraph events to SSE format for frontend
- **Thread Management**: CRUD operations for conversation threads
- **Unity Integration**: Passes `UnityManager` instance to tools
- **API Key Management**: Reads from VS Code secret storage

**Key Methods**:
```typescript
async chat(request: ChatRequest): AsyncIterable<AgentEvent>
async getThreads(): Promise<Thread[]>
async getThreadMessages(threadId: string): Promise<Message[]>
async deleteThread(threadId: string): Promise<void>
```

### Webview Management

**File**: `src/NextWebview.ts`

- **`NextWebviewPanel`**: Singleton pattern for floating panels. One instance per `viewId`.
- **HTML Generation**: Injects nonce for CSP, `data-route` attribute for React router.
- **Output paths**: `out/webviews/index.mjs` and `out/webviews/style.css`
- **Message Router**: Proxies webview messages to extension handlers

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
| `useUnityStatus` | `lib/hooks/useUnityStatus.ts` | Polls Unity connection status from extension |
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

### Agent Factory

**File**: `src/agent/agent.ts`

Creates the LangGraph agent with Unity tools and configuration:

```typescript
import { createMovesiaAgent } from './agent'

const agent = createMovesiaAgent({
  openRouterApiKey: 'sk-or-...',
  tavilyApiKey: 'tvly-...',
  projectPath: 'C:/MyUnityProject',
  unityManager: unityManagerInstance,
  checkpointer: sqlJsCheckpointer  // Defaults to MemorySaver if not provided
})
```

**Model Configuration**:
```typescript
new ChatOpenAI({
  modelName: 'anthropic/claude-haiku-4.5',
  configuration: { baseURL: 'https://openrouter.ai/api/v1' },
  apiKey: process.env.OPENROUTER_API_KEY
})
```

**Tools**:
- Unity tools (6 tools - see Unity Tools section)
- Tavily search (optional - disabled if no API key)

### Persistence Layer

**File**: `src/agent/database/SqlJsCheckpointer.ts`

Custom LangGraph checkpointer implementation using `sql.js`:

- **Backend**: In-memory SQLite database (via sql.js WASM)
- **Storage**: Conversations persist to `~/.movesia/checkpoints.sqlite`
- **Tables**: `checkpoints`, `writes`
- **Thread Safety**: Async locks for concurrent access
- **Portability**: No native dependencies, works on all platforms

**Database Engine** (`src/agent/database/engine.ts`):
- Lazy initialization of sql.js
- Automatic directory creation for storage path
- Export/import functionality for backups

**Repository Layer** (`src/agent/database/repository.ts`):
- `ConversationRepository` - CRUD for conversations
- `MessageRepository` - Message storage with tool calls
- Thread metadata management

### Streaming

**File**: `src/services/agent-service.ts` (method: `chat()`)

Converts LangGraph events to SSE format for frontend:

```typescript
async *chat(request: ChatRequest): AsyncIterable<AgentEvent> {
  // Streams LangGraph events as AgentEvent objects
  yield { type: 'thinking' }
  yield { type: 'token', delta: '...' }
  yield { type: 'tool_start', name: 'unity_query', ... }
  yield { type: 'tool_output', output: {...} }
  yield { type: 'complete', threadId: '...' }
}
```

**Event Types**:
- `thinking` - Agent started processing
- `token` - LLM streaming chunk
- `tool_start` - Tool execution began (includes `textLengthAtEvent` for positioning)
- `tool_input` - Tool input captured
- `tool_output` - Tool result received
- `tool_error` - Tool failed
- `complete` - Agent finished
- `error` - Error occurred

**Tool Call Lifecycle**:
1. `tool_start` → Frontend shows "running" state
2. `tool_input` → Input displayed in UI
3. `tool_output` → Output displayed, state = "completed"
4. `tool_error` → Error displayed, state = "error"

### Unity Connection

**File**: `src/agent/UnityConnection/UnityManager.ts`

Manages WebSocket connection to Unity Editor:

- **Connection Management**: Single active connection per project
- **Message Routing**: Correlates requests/responses via message IDs
- **Heartbeat**: Periodic pings with compilation status detection
- **Command Interface**: `sendCommand(action, payload)` returns Promise
- **Event System**: EventEmitter for connection state changes

**Unity WebSocket** (`src/agent/UnityConnection/UnityWsServer.ts`):
- HTTP server with WebSocket upgrade endpoint at `/ws/unity`
- Handshake validation (project path, Unity version)
- Heartbeat monitoring with timeout detection

---

## Unity Tools (6 Tools)

Located in `src/agent/unity-tools/`. All target **Unity 6** (6000.x) API.

### 1. unity_query (The Observer) - Read-Only

**File**: `src/agent/unity-tools/query.ts`

| Action | Params | Returns |
|--------|--------|---------|
| `hierarchy` | `max_depth` (default: 5) | Scene tree with instance IDs |
| `inspect_object` | `instance_id` | All components and properties |
| `search_assets` | `search_query`, `asset_type` | Matching prefabs/scripts/assets |
| `get_logs` | `log_filter` (Error/Warning/Exception) | Filtered console logs |
| `get_settings` | `settings_category` | Physics/player/quality settings |

### 2. unity_hierarchy (The Architect) - Scene Graph

**File**: `src/agent/unity-tools/hierarchy.ts`

| Action | Params | Effect |
|--------|--------|--------|
| `create` | `name`, `primitive_type`, `parent_id`, `position` | New GameObject |
| `duplicate` | `instance_id` | Clone existing |
| `destroy` | `instance_id` | Remove (Undo supported) |
| `rename` | `instance_id`, `name` | Change name |
| `reparent` | `instance_id`, `parent_id` | Move in hierarchy |
| `move_scene` | `instance_id`, `target_scene` | Move between scenes |

### 3. unity_component (The Engineer) - Behavior/Data

**File**: `src/agent/unity-tools/component.ts`

| Action | Params | Effect |
|--------|--------|--------|
| `add` | `game_object_id`, `component_type` | Attach component |
| `modify` | `properties`, `game_object_id` + `component_type` | Change properties |
| `remove` | `game_object_id` + `component_type` | Delete component |

**Property format**: Vectors use arrays `[x, y, z]`, not objects.
```typescript
{ m_LocalPosition: [0, 5, 0] }  // Correct
```

### 4. unity_prefab (The Factory) - Templates

**File**: `src/agent/unity-tools/prefab.ts`

| Action | Params | Effect |
|--------|--------|--------|
| `instantiate` | `asset_path`, `position`, `rotation` | Spawn by path |
| `instantiate_by_name` | `prefab_name`, `position`, `rotation` | Search and spawn |
| `create_asset` | `instance_id`, `asset_path` | Create prefab from scene |
| `modify_asset` | `asset_path`, `component_type`, `properties` | Edit .prefab file |
| `apply` | `instance_id` | Push scene changes to asset |
| `revert` | `instance_id` | Reset to asset state |

### 5. unity_scene (The Director) - Environment

**File**: `src/agent/unity-tools/scene.ts`

| Action | Params | Effect |
|--------|--------|--------|
| `open` | `path`, `additive` | Load scene |
| `save` | `path` (optional) | Save current/new path |
| `create` | `path` (must end .unity), `additive` | Create new scene |
| `set_active` | `path` | Set active scene (must be loaded) |

### 6. unity_refresh (The Compiler) - Script Compilation

**File**: `src/agent/unity-tools/refresh.ts`

Triggers Unity Asset Database refresh. Uses LangGraph `interrupt()` to pause agent.

```typescript
await unityRefresh({ watched_scripts: ['PlayerController'] })
// Agent pauses, waits for Unity compilation...
// Returns: { status: 'SUCCESS', verification: { PlayerController: true } }
```

**Critical workflow**: Always refresh after creating scripts before adding components.

---

## Directory Structure

```
src/
├── extension.ts                 # Extension activation, command registration
├── NextWebview.ts               # Webview panel/sidebar base classes
├── services/
│   ├── agent-service.ts         # AgentService - LangGraph execution & streaming
│   ├── unity-package-installer.ts   # Unity package manager integration
│   └── unity-project-scanner.ts     # Find Unity projects on filesystem
├── agent/
│   ├── agent.ts                 # LangGraph agent factory
│   ├── prompts.ts               # System prompts (Unity 6 API)
│   ├── utils.ts                 # Text chunking utilities
│   ├── database/
│   │   ├── SqlJsCheckpointer.ts # Custom LangGraph checkpointer
│   │   ├── engine.ts            # sql.js database engine
│   │   ├── repository.ts        # Conversation/message repositories
│   │   ├── models.ts            # TypeScript data models
│   │   └── index.ts             # Public exports
│   ├── middlewares/
│   │   └── index.ts             # LangGraph middleware (if any)
│   ├── UnityConnection/
│   │   ├── UnityManager.ts      # WebSocket connection manager
│   │   ├── UnityWsServer.ts     # WebSocket server
│   │   ├── types.ts             # Message types
│   │   └── index.ts             # Public exports
│   └── unity-tools/
│       ├── index.ts             # Tool registration
│       ├── connection.ts        # Unity tool base class
│       ├── query.ts             # unity_query tool
│       ├── hierarchy.ts         # unity_hierarchy tool
│       ├── component.ts         # unity_component tool
│       ├── prefab.ts            # unity_prefab tool
│       ├── scene.ts             # unity_scene tool
│       ├── refresh.ts           # unity_refresh tool (with interrupt)
│       └── types.ts             # Shared types
└── webviews/
    ├── src/
    │   ├── index.tsx            # React entry, MemoryRouter setup
    │   ├── ChatView.tsx         # Main chat interface
    │   ├── View2.tsx            # Zustand demo view
    │   ├── testMessages.ts      # Markdown test data
    │   └── lib/
    │       ├── components/      # UI components
    │       │   ├── ChatInput.tsx
    │       │   ├── MarkdownRenderer.tsx
    │       │   ├── ThreadSelector.tsx
    │       │   ├── UnityStatusIndicator.tsx
    │       │   ├── FieldWithDescription.tsx
    │       │   ├── Toggle.tsx
    │       │   ├── tools/       # Pluggable tool UI system
    │       │   │   ├── index.ts          # Public exports
    │       │   │   ├── types.ts          # ToolCallData, ToolUIProps interfaces
    │       │   │   ├── registry.ts       # Tool registration/lookup
    │       │   │   ├── DefaultToolUI.tsx # Fallback JSON display
    │       │   │   ├── ToolUIWrapper.tsx # Collapsible wrapper
    │       │   │   └── custom/           # Unity tool UIs
    │       │   └── ui/          # Radix-based primitives
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
    │       ├── VSCodeAPI.tsx    # VS Code API wrapper
    │       ├── utils.ts         # cn() utility for classnames
    │       └── vscode.css       # Tailwind entry + VS Code variables
    └── public/                  # Static assets

agent-python-(deprecated)/       # Legacy Python implementation (DO NOT USE)
```

---

## Configuration

### Build Configuration

- **TypeScript**: `tsconfig.json` - ES2020 target, outputs to `out/`, excludes webviews
- **Vite**: `vite.config.mjs` - React plugin, library output to `out/webviews/index.mjs`
- **Tailwind**: `tailwind.config.js` - VS Code theme colors via `@githubocto/tailwind-vscode`
- **PostCSS**: `postcss.config.cjs` - Tailwind + nesting plugin

### Extension Settings

API keys are stored in VS Code secret storage (not in settings.json):

- `movesia.openRouterApiKey` - OpenRouter API key for LLM access
- `movesia.tavilyApiKey` - Tavily API key for internet search (optional)

Unity project path is stored in workspace state and selected via UI.

### Storage Locations

- **Conversation Database**: `~/.movesia/checkpoints.sqlite` (sql.js)
- **Workspace State**: `.vscode/settings.json` (selected project path)
- **Secret Storage**: VS Code's platform-specific secure storage

---

## Key Patterns

- **Embedded Agent**: LangGraph runs in extension process, no separate server
- **Singleton webviews**: One panel instance per route via static `instances` map
- **Message passing**: Extension ↔ Webview via `postMessage` API
- **Interrupt/checkpoint**: Agent pauses for async Unity ops (compilation), resumes with result
- **Dual build**: TypeScript (tsc) + Vite run in parallel via `.vscode/tasks.json`
- **VS Code theme integration**: Tailwind classes map to CSS variables (`bg-vscode-editor-background`)
- **Interleaved tool rendering**: Tool calls appear inline with text at their invocation position using `textLengthAtEvent` markers
- **SSE streaming**: Chat uses SSE format for frontend via async iterables
- **Pluggable tool UIs**: Register custom React components per tool name for rich rendering
- **sql.js persistence**: Conversations stored in portable SQLite database without native dependencies

---

## Dependencies

### Extension (package.json)

**Frontend**:
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

**Backend (Agent)**:
| Package | Version | Purpose |
|---------|---------|---------|
| `@langchain/langgraph` | latest | Agent framework |
| `@langchain/openai` | latest | LLM integration |
| `@langchain/tavily` | latest | Internet search tool |
| `sql.js` | latest | WASM SQLite for checkpoints |
| `ws` | latest | WebSocket server for Unity |

---

## Migration Notes

### Python → TypeScript Migration

The agent was migrated from Python (FastAPI server) to TypeScript (embedded in extension):

**Benefits**:
- ✅ Single process - no separate server to manage
- ✅ Simpler deployment - just install the extension
- ✅ Better debugging - all code runs in extension host
- ✅ Portable persistence - sql.js works on all platforms
- ✅ Direct API key access - uses VS Code secret storage

**Breaking Changes**:
- ❌ No HTTP endpoints - agent runs in-process
- ❌ No Python dependencies - all TypeScript/Node.js
- ❌ New database format - conversations not compatible with old Python checkpoints

**Deprecated**:
- `agent/` directory (Python) → moved to `agent-python-(deprecated)/`
- FastAPI server endpoints
- Python-based tools and middleware

---

## Development Tips

### Debugging the Agent

1. Set breakpoints in `src/agent/agent.ts` or `src/services/agent-service.ts`
2. Press F5 to launch Extension Development Host
3. Open "Movesia AI Chat" command
4. Breakpoints will trigger in your main VS Code window

### Testing Unity Tools

1. Open a Unity project and install the Movesia package
2. Ensure Unity Editor is running
3. Check Unity connection status in chat interface (green = connected)
4. Test tools via chat: "Show me the hierarchy" → triggers `unity_query`

### Database Inspection

```bash
# Install sql.js CLI (optional)
npm install -g sql.js

# Inspect database
sqlite3 ~/.movesia/checkpoints.sqlite
> .tables
> SELECT * FROM conversations;
```

### Viewing Logs

- **Extension Host**: Debug Console in VS Code
- **Movesia Output**: View → Output → Select "Movesia Agent"
- **LangGraph Events**: Console logs during streaming

---

## Common Tasks

### Adding a New Unity Tool

1. Create tool file in `src/agent/unity-tools/my-tool.ts`
2. Define LangChain `StructuredTool` with Zod schema
3. Export tool in `src/agent/unity-tools/index.ts`
4. Add to `unityTools` array
5. (Optional) Create custom UI in `src/webviews/src/lib/components/tools/custom/`
6. Register UI in `src/webviews/src/ChatView.tsx`

### Updating the LLM Model

Edit `src/agent/agent.ts`:

```typescript
export function createModel(apiKey?: string) {
  return new ChatOpenAI({
    modelName: 'anthropic/claude-sonnet-4.5',  // Change here
    configuration: { baseURL: 'https://openrouter.ai/api/v1' },
    apiKey: apiKey ?? process.env.OPENROUTER_API_KEY,
  })
}
```

### Customizing System Prompt

Edit `src/agent/prompts.ts`:

```typescript
export const UNITY_AGENT_PROMPT = `
You are Movesia, an AI assistant for Unity game development...
`
```

---

## Troubleshooting

### Agent Not Responding

1. Check "Movesia Agent" output panel for errors
2. Verify API key is set: Command Palette → "Movesia: Set OpenRouter API Key"
3. Check Debug Console for initialization errors

### Unity Tools Failing

1. Verify Unity Editor is running
2. Check Movesia package is installed in Unity project
3. Look for WebSocket connection errors in output panel
4. Unity status indicator should be green (connected)

### Database Errors

1. Check `~/.movesia/` directory exists and is writable
2. Delete `checkpoints.sqlite` to reset (conversations will be lost)
3. Check for file permission errors in output panel

### Build Errors

1. Clean build: `rm -rf out/ && npm run compile`
2. Reinstall dependencies: `rm -rf node_modules && npm install`
3. Check TypeScript version: `npm list typescript`
