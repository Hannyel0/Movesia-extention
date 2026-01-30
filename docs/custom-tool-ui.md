# Custom Tool UI Guide

This guide explains how to create custom UI components for agent tools in the Movesia extension.

## Overview

The tool UI system uses a **registry pattern** that maps tool names to React components. When a tool executes, the system looks up its registered component and renders it. Tools without custom UIs fall back to `DefaultToolUI`, which displays formatted JSON.

## Architecture

```
tools/
├── types.ts              # Type definitions for all tools
├── registry.ts           # Tool name → component mapping
├── DefaultToolUI.tsx     # Fallback JSON display
├── ToolUIWrapper.tsx     # Collapsible wrapper chrome
├── registerCustomToolUIs.ts  # Registration setup
├── index.ts              # Public exports
└── custom/               # Custom tool UI components
    ├── index.ts
    ├── UnityQueryUI.tsx
    ├── UnityHierarchyUI.tsx
    └── UnityRefreshUI.tsx
```

## Creating a Custom Tool UI

### Step 1: Define Types

Add your tool's input/output types to `tools/types.ts`:

```typescript
// In tools/types.ts

export namespace MyTool {
  export interface Input {
    action: 'do_something' | 'do_other'
    target?: string
    options?: Record<string, unknown>
  }

  export interface Output {
    success?: boolean
    error?: string
    result?: {
      id: number
      name: string
      data: unknown
    }
  }
}
```

### Step 2: Create the Component

Create a new file in `tools/custom/MyToolUI.tsx`:

```typescript
import React from 'react'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '../../../utils'
import type { ToolUIProps, MyTool } from '../types'

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Parse tool output into typed data.
 * Handles JSON strings and already-parsed objects.
 */
function parseOutput(output: unknown): MyTool.Output | undefined {
  if (!output) return undefined

  // Already an object - return as-is
  if (typeof output === 'object') {
    return output as MyTool.Output
  }

  // JSON string - parse it
  if (typeof output === 'string') {
    try {
      return JSON.parse(output) as MyTool.Output
    } catch {
      // Parse failed - return as error
      return { error: output } as MyTool.Output
    }
  }

  return output as MyTool.Output
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function MyToolUI({
  tool,
  input,
  output,
  isActive,
}: ToolUIProps<MyTool.Input, MyTool.Output>) {
  const typedInput = input as MyTool.Input | undefined
  const typedOutput = React.useMemo(() => parseOutput(output), [output])

  // Loading state - tool is executing
  if (isActive && !typedOutput) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-md bg-blue-500/10">
        <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
        <div className="flex-1">
          <div className="text-sm font-medium">Processing...</div>
          <div className="text-xs text-muted-foreground">
            {typedInput?.action}
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (tool.error || typedOutput?.error) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-md bg-red-500/10">
        <AlertCircle className="w-5 h-5 text-red-400" />
        <div className="flex-1">
          <div className="text-sm font-medium text-red-400">Failed</div>
          <div className="text-xs text-red-300">
            {tool.error || typedOutput?.error}
          </div>
        </div>
      </div>
    )
  }

  // Success state
  return (
    <div className="flex items-center gap-3 p-3 rounded-md bg-green-500/10">
      <CheckCircle2 className="w-5 h-5 text-green-400" />
      <div className="flex-1">
        <div className="text-sm font-medium">Success</div>
        {typedOutput?.result && (
          <div className="text-xs text-muted-foreground">
            {typedOutput.result.name} (#{typedOutput.result.id})
          </div>
        )}
      </div>
    </div>
  )
}

export default MyToolUI
```

### Step 3: Export the Component

Add to `tools/custom/index.ts`:

```typescript
export { UnityQueryUI } from './UnityQueryUI'
export { UnityHierarchyUI } from './UnityHierarchyUI'
export { UnityRefreshUI } from './UnityRefreshUI'
export { MyToolUI } from './MyToolUI'  // Add this line
```

### Step 4: Register the Component

Add to `tools/registerCustomToolUIs.ts`:

```typescript
import { UnityQueryUI, UnityHierarchyUI, UnityRefreshUI, MyToolUI } from './custom'

export function registerCustomToolUIs(): void {
  // Existing registrations...
  registerToolUI('unity_query', UnityQueryUI, {
    displayName: 'Query Unity',
    category: 'unity',
  })

  // Add your new tool
  registerToolUI('my_tool', MyToolUI, {
    displayName: 'My Tool',
    category: 'custom',  // or 'unity', 'filesystem', etc.
  })
}
```

## Component Props

Every custom tool UI receives these props via `ToolUIProps<I, O>`:

| Prop | Type | Description |
|------|------|-------------|
| `tool` | `ToolCallData` | Tool metadata (id, name, state, error) |
| `input` | `I \| undefined` | Parsed input parameters |
| `output` | `O \| undefined` | Parsed output (may be string or object) |
| `isActive` | `boolean` | True while tool is executing |

## Tool States

Tools progress through these states:

1. **streaming** - Tool call detected, waiting for input
2. **executing** - Input received, tool running (`isActive = true`)
3. **completed** - Output received (`isActive = false`)
4. **error** - Tool failed (`tool.error` is set)

## Best Practices

### Always Use parseOutput()

The output can arrive as a JSON string or already-parsed object. Always use the parseOutput helper:

```typescript
const typedOutput = React.useMemo(() => parseOutput(output), [output])
```

### Handle All States

Always handle loading, error, and success states:

```typescript
// Loading
if (isActive && !typedOutput) {
  return <LoadingUI />
}

// Error
if (tool.error || typedOutput?.error) {
  return <ErrorUI error={tool.error || typedOutput?.error} />
}

// Success
return <SuccessUI data={typedOutput} />
```

### Use VS Code Theme Colors

Use Tailwind classes that map to VS Code theme variables:

```typescript
// Good - uses VS Code theme
className="bg-[var(--vscode-editor-background)]"
className="text-[var(--vscode-foreground)]"
className="border-[var(--vscode-panel-border)]"

// Also good - semi-transparent overlays
className="bg-green-500/10"  // 10% opacity green
className="bg-red-500/10"    // 10% opacity red
```

### Keep Components Focused

Each component should handle one tool. If a tool has multiple actions (like `unity_query`), use conditional rendering:

```typescript
return (
  <div>
    {typedInput?.action === 'hierarchy' && <HierarchyView output={typedOutput} />}
    {typedInput?.action === 'search' && <SearchView output={typedOutput} />}
  </div>
)
```

### Memoize Expensive Operations

Use `useMemo` for parsing and `useState` for expandable sections:

```typescript
const typedOutput = React.useMemo(() => parseOutput(output), [output])
const [isExpanded, setIsExpanded] = useState(false)
```

## Available Icons

Import icons from `lucide-react`:

```typescript
import {
  CheckCircle2,    // Success
  XCircle,         // Failure
  AlertCircle,     // Error/Warning
  Loader2,         // Loading (use with animate-spin)
  Box,             // GameObject
  FileCode,        // Script/Code
  Folder,          // Directory/Scene
  Eye,             // Inspect/View
  Search,          // Search
  Settings,        // Configuration
  RefreshCw,       // Refresh (use with animate-spin)
  ChevronRight,    // Collapsed
  ChevronDown,     // Expanded
} from 'lucide-react'
```

## Debugging

Enable debug logging in your component:

```typescript
const DEBUG = true
function log(msg: string, data?: unknown) {
  if (DEBUG) console.log(`[MyToolUI] ${msg}`, data)
}

// In component
log('Received output', typedOutput)
```

## Example: Action-Based UI

For tools with multiple actions, use a config pattern:

```typescript
interface ActionConfig {
  icon: React.ComponentType<{ className?: string }>
  color: string
  bgColor: string
  label: string
}

const ACTION_CONFIGS: Record<string, ActionConfig> = {
  create: {
    icon: Plus,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    label: 'Create',
  },
  delete: {
    icon: Trash2,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    label: 'Delete',
  },
}

// In component
const config = ACTION_CONFIGS[typedInput?.action || 'create']
const Icon = config.icon

return (
  <div className={cn('p-3 rounded-md', config.bgColor)}>
    <Icon className={cn('w-5 h-5', config.color)} />
    <span>{config.label}</span>
  </div>
)
```
