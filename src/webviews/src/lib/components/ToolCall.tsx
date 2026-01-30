/**
 * Tool Call Components - Re-exports from pluggable tool UI system
 *
 * This file maintains backwards compatibility with existing imports.
 * All functionality has been moved to the ./tools/ directory.
 *
 * @deprecated Import from './tools' instead for new code
 */

// Re-export types
export type { ToolCallState, ToolCallData } from './tools/types'

// Re-export components with original names
export { ToolUIWrapper as ToolCall, ToolUIList as ToolCallList } from './tools/ToolUIWrapper'

// Re-export registry functions for convenience
export { getToolDisplayName, getToolColor } from './tools/registry'
