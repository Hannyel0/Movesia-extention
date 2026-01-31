/**
 * Pluggable Tool UI System - Type Definitions
 *
 * This file defines the core interfaces that all tool UI components must implement.
 * Custom tool UIs receive standardized props and can render tool-specific interfaces.
 */

import type { ReactNode, ComponentType } from 'react'

// =============================================================================
// CORE TYPES
// =============================================================================

/**
 * Tool execution states - matches the streaming lifecycle
 */
export type ToolCallState = 'streaming' | 'executing' | 'completed' | 'error'

/**
 * Core tool call data passed to all tool UI components
 */
export interface ToolCallData {
  /** Unique identifier for this tool call */
  id: string
  /** Tool name (e.g., 'unity_query', 'unity_hierarchy') */
  name: string
  /** Current execution state */
  state: ToolCallState
  /** Tool input parameters (typed per-tool in custom UIs) */
  input?: unknown
  /** Tool output result (typed per-tool in custom UIs) */
  output?: unknown
  /** Error message if state is 'error' */
  error?: string
  /** Character offset in message text where tool started (for interleaved rendering) */
  textOffsetStart?: number
  /** Character offset in message text where tool completed (for interleaved rendering) */
  textOffsetEnd?: number
}

// =============================================================================
// TOOL UI COMPONENT PROPS
// =============================================================================

/**
 * Standard props passed to all tool UI components.
 * Custom tool UIs must accept this interface.
 */
export interface ToolUIProps<TInput = unknown, TOutput = unknown> {
  /** The tool call data */
  tool: ToolCallData
  /** Typed input (same as tool.input but with proper type) */
  input: TInput | undefined
  /** Typed output (same as tool.output but with proper type) */
  output: TOutput | undefined
  /** Whether the collapsible content is expanded */
  isExpanded: boolean
  /** Callback to toggle expansion */
  onToggleExpand: () => void
  /** Whether the tool is currently active (streaming/executing) */
  isActive: boolean
}

/**
 * Type for a tool UI component
 */
export type ToolUIComponent<TInput = unknown, TOutput = unknown> = ComponentType<
  ToolUIProps<TInput, TOutput>
>

// =============================================================================
// TOOL CONFIGURATION
// =============================================================================

/**
 * Visual configuration for a tool
 */
export interface ToolConfig {
  /** Display name shown in the UI */
  displayName: string
  /** Tailwind color class for the tool icon */
  color: string
  /** Optional icon component override */
  icon?: ComponentType<{ className?: string }>
  /** Default expansion state */
  defaultExpanded?: boolean
  /** Tool category for grouping */
  category?: 'query' | 'mutation' | 'system'
  /** Short description for tooltips */
  description?: string
}

/**
 * Full tool registration including UI component
 */
export interface ToolRegistration<TInput = unknown, TOutput = unknown> {
  /** Tool configuration (display name, color, etc.) */
  config: ToolConfig
  /** Custom UI component (optional - falls back to default) */
  component?: ToolUIComponent<TInput, TOutput>
  /**
   * When true, the component is rendered directly without the standard wrapper.
   *
   * Full custom mode bypasses the ToolUIWrapper entirely, meaning:
   * - No collapsible header with tool name and chevron
   * - No border/background styling from the wrapper
   * - No state icon (spinner, checkmark, error)
   * - Your component controls 100% of the rendered output
   *
   * Use this when you need complete control over the tool's visual presentation,
   * such as inline confirmations, custom cards, or non-standard layouts.
   */
  fullCustom?: boolean
}

// =============================================================================
// TOOL-SPECIFIC INPUT/OUTPUT TYPES
// =============================================================================

/**
 * Unity Query Tool Types
 */
export namespace UnityQuery {
  export type Action =
    | 'hierarchy'
    | 'inspect_object'
    | 'search_assets'
    | 'get_logs'
    | 'get_settings'

  export interface Input {
    action: Action
    max_depth?: number
    instance_id?: number
    search_query?: string
    asset_type?: string
    log_filter?: string
    settings_category?: string
  }

  // Hierarchy output
  export interface HierarchyNode {
    name: string
    instanceId: number
    activeSelf: boolean
    children?: HierarchyNode[]
    components?: string[]
  }

  export interface HierarchyOutput {
    success: boolean
    scenes?: Array<{
      name: string
      path: string
      isActive: boolean
      rootObjects: HierarchyNode[]
    }>
    error?: string
  }

  // Inspect output
  export interface ComponentData {
    type: string
    properties: Record<string, unknown>
  }

  export interface InspectOutput {
    success: boolean
    name?: string
    instanceId?: number
    tag?: string
    layer?: string
    isActive?: boolean
    components?: ComponentData[]
    error?: string
  }

  // Search output
  export interface AssetResult {
    name: string
    path: string
    type: string
    guid?: string
  }

  export interface SearchOutput {
    success: boolean
    assets?: AssetResult[]
    count?: number
    error?: string
  }

  // Logs output
  export interface LogEntry {
    message: string
    type: 'Log' | 'Warning' | 'Error' | 'Exception'
    stackTrace?: string
    timestamp?: string
  }

  export interface LogsOutput {
    success: boolean
    logs?: LogEntry[]
    count?: number
    error?: string
  }

  // Generic output union
  export type Output = HierarchyOutput | InspectOutput | SearchOutput | LogsOutput | { error: string }
}

/**
 * Unity Hierarchy Tool Types
 */
export namespace UnityHierarchy {
  export type Action =
    | 'create'
    | 'duplicate'
    | 'destroy'
    | 'rename'
    | 'reparent'
    | 'move_scene'

  export interface Input {
    action: Action
    instance_id?: number
    name?: string
    primitive_type?: string
    parent_id?: number
    position?: [number, number, number]
    target_scene?: string
  }

  export interface Output {
    success: boolean
    instanceId?: number
    name?: string
    message?: string
    error?: string
  }
}

/**
 * Unity Component Tool Types
 */
export namespace UnityComponent {
  export type Action = 'add' | 'modify' | 'remove'

  export interface Input {
    action: Action
    game_object_id: number
    component_type: string
    properties?: Record<string, unknown>
  }

  export interface Output {
    success: boolean
    message?: string
    error?: string
  }
}

/**
 * Unity Prefab Tool Types
 */
export namespace UnityPrefab {
  export type Action =
    | 'instantiate'
    | 'instantiate_by_name'
    | 'create_asset'
    | 'modify_asset'
    | 'apply'
    | 'revert'

  export interface Input {
    action: Action
    asset_path?: string
    prefab_name?: string
    instance_id?: number
    position?: [number, number, number]
    rotation?: [number, number, number]
    component_type?: string
    properties?: Record<string, unknown>
  }

  export interface Output {
    success: boolean
    instanceId?: number
    assetPath?: string
    message?: string
    error?: string
  }
}

/**
 * Unity Scene Tool Types
 */
export namespace UnityScene {
  export type Action = 'open' | 'save' | 'create' | 'set_active'

  export interface Input {
    action: Action
    path?: string
    additive?: boolean
  }

  export interface Output {
    success: boolean
    scenePath?: string
    message?: string
    error?: string
  }
}

/**
 * Unity Refresh Tool Types
 */
export namespace UnityRefresh {
  export interface Input {
    watched_scripts?: string[]
  }

  export interface VerificationResult {
    [scriptName: string]: boolean
  }

  export interface Output {
    status: 'SUCCESS' | 'FAILED' | 'TIMEOUT'
    verification?: VerificationResult
    errors?: string[]
    message?: string
  }
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Map of tool names to their input/output types
 */
export interface ToolTypeMap {
  unity_query: { input: UnityQuery.Input; output: UnityQuery.Output }
  unity_hierarchy: { input: UnityHierarchy.Input; output: UnityHierarchy.Output }
  unity_component: { input: UnityComponent.Input; output: UnityComponent.Output }
  unity_prefab: { input: UnityPrefab.Input; output: UnityPrefab.Output }
  unity_scene: { input: UnityScene.Input; output: UnityScene.Output }
  unity_refresh: { input: UnityRefresh.Input; output: UnityRefresh.Output }
}

/**
 * Helper type to get input type for a tool
 */
export type ToolInput<T extends keyof ToolTypeMap> = ToolTypeMap[T]['input']

/**
 * Helper type to get output type for a tool
 */
export type ToolOutput<T extends keyof ToolTypeMap> = ToolTypeMap[T]['output']
