/**
 * Pluggable Tool UI System
 *
 * This module provides a flexible, extensible system for rendering tool call UIs.
 *
 * ## Quick Start
 *
 * ### Using the default UI (no custom components):
 * ```tsx
 * import { ToolUIList } from './tools'
 *
 * <ToolUIList tools={toolCalls} />
 * ```
 *
 * ### Registering a custom tool UI:
 * ```tsx
 * import { registerToolUI } from './tools'
 * import { MyCustomToolUI } from './my-tool-ui'
 *
 * // Register at app startup
 * registerToolUI('my_custom_tool', {
 *   config: {
 *     displayName: 'My Custom Tool',
 *     color: 'text-pink-400',
 *   },
 *   component: MyCustomToolUI,
 * })
 * ```
 *
 * ### Creating a custom tool UI component:
 * ```tsx
 * import type { ToolUIProps } from './tools'
 *
 * interface MyInput { action: string; value: number }
 * interface MyOutput { result: string; success: boolean }
 *
 * export function MyCustomToolUI({ input, output, isActive }: ToolUIProps<MyInput, MyOutput>) {
 *   const typedInput = input as MyInput
 *   const typedOutput = output as MyOutput
 *
 *   return (
 *     <div>
 *       {typedInput && <p>Action: {typedInput.action}</p>}
 *       {typedOutput && <p>Result: {typedOutput.result}</p>}
 *       {isActive && <p>Loading...</p>}
 *     </div>
 *   )
 * }
 * ```
 *
 * ## Architecture
 *
 * - **types.ts**: Core interfaces (ToolUIProps, ToolCallData, etc.)
 * - **registry.ts**: Tool registration and lookup
 * - **DefaultToolUI.tsx**: Fallback JSON display
 * - **ToolUIWrapper.tsx**: Chrome/wrapper with collapsible header
 * - **custom/**: Directory for custom tool UI implementations
 */

// Core types
export type {
  ToolCallState,
  ToolCallData,
  ToolUIProps,
  ToolUIComponent,
  ToolConfig,
  ToolRegistration,
  ToolTypeMap,
  ToolInput,
  ToolOutput,
} from './types'

// Tool-specific types (namespaced)
export type {
  UnityQuery,
  UnityHierarchy,
  UnityComponent,
  UnityPrefab,
  UnityScene,
  UnityRefresh,
} from './types'

// Registry API
export {
  registerToolUI,
  unregisterToolUI,
  getToolUIComponent,
  getToolConfig,
  getToolRegistration,
  hasCustomUI,
  getRegisteredTools,
  clearRegistry,
  getToolDisplayName,
  getToolColor,
  getToolCategory,
  registerTools,
  initializeDefaultConfigs,
} from './registry'

// Components
export { DefaultToolUI } from './DefaultToolUI'
export { ToolUIWrapper, ToolUIList } from './ToolUIWrapper'

// Re-export wrapper as the main component names for backwards compatibility
// and ease of use
export { ToolUIWrapper as ToolCall } from './ToolUIWrapper'
export { ToolUIList as ToolCallList } from './ToolUIWrapper'

// Registration
export { registerCustomToolUIs, ensureCustomToolUIsRegistered } from './registerCustomToolUIs'

// Custom tool UIs (for direct import if needed)
export * from './custom'
