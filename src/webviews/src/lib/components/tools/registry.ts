/**
 * Pluggable Tool UI System - Registry
 *
 * Central registry that maps tool names to their UI components and configurations.
 * This is the core of the pluggable system - to add a new tool UI:
 *
 * 1. Create your component implementing ToolUIProps
 * 2. Call registerToolUI('tool_name', { config, component })
 *
 * The registry will automatically use your component when rendering that tool.
 */

import type { ComponentType } from 'react'
import type { ToolConfig, ToolRegistration, ToolUIProps, ToolUIComponent } from './types'

// =============================================================================
// REGISTRY STATE
// =============================================================================

/**
 * Internal storage for tool registrations
 */
const toolRegistry = new Map<string, ToolRegistration>()

/**
 * Default tool configurations for known tools
 */
const defaultConfigs: Record<string, ToolConfig> = {
  unity_query: {
    displayName: 'Query Unity',
    color: 'text-blue-400',
    category: 'query',
    description: 'Read the current state of the Unity Editor',
  },
  unity_hierarchy: {
    displayName: 'Modify Hierarchy',
    color: 'text-green-400',
    category: 'mutation',
    description: 'Manage GameObject structure in the scene',
  },
  unity_component: {
    displayName: 'Modify Component',
    color: 'text-purple-400',
    category: 'mutation',
    description: 'Add, modify, or remove components',
  },
  unity_prefab: {
    displayName: 'Prefab Operation',
    color: 'text-orange-400',
    category: 'mutation',
    description: 'Work with prefab assets and instances',
  },
  unity_scene: {
    displayName: 'Scene Operation',
    color: 'text-cyan-400',
    category: 'mutation',
    description: 'Manage scenes in the project',
  },
  unity_refresh: {
    displayName: 'Refresh Assets',
    color: 'text-yellow-400',
    category: 'system',
    description: 'Trigger Unity asset database refresh',
  },
}

// =============================================================================
// REGISTRY API
// =============================================================================

/**
 * Register a tool UI component and/or configuration.
 *
 * @example
 * // Register just config (uses default UI)
 * registerToolUI('my_tool', {
 *   config: { displayName: 'My Tool', color: 'text-pink-400' }
 * })
 *
 * @example
 * // Register with custom component
 * registerToolUI('unity_query', {
 *   config: { displayName: 'Query Unity', color: 'text-blue-400' },
 *   component: UnityQueryToolUI
 * })
 */
export function registerToolUI<TInput = unknown, TOutput = unknown>(
  toolName: string,
  registration: ToolRegistration<TInput, TOutput>
): void {
  toolRegistry.set(toolName, registration as ToolRegistration)
}

/**
 * Unregister a tool UI (useful for hot-reloading or cleanup)
 */
export function unregisterToolUI(toolName: string): boolean {
  return toolRegistry.delete(toolName)
}

/**
 * Get the registered UI component for a tool.
 * Returns undefined if no custom component is registered.
 */
export function getToolUIComponent(toolName: string): ToolUIComponent | undefined {
  return toolRegistry.get(toolName)?.component
}

/**
 * Get the configuration for a tool.
 * Falls back to default config, then generates a basic one.
 */
export function getToolConfig(toolName: string): ToolConfig {
  // Check registry first
  const registration = toolRegistry.get(toolName)
  if (registration?.config) {
    return registration.config
  }

  // Fall back to default configs
  if (defaultConfigs[toolName]) {
    return defaultConfigs[toolName]
  }

  // Generate basic config for unknown tools
  return {
    displayName: toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    color: 'text-gray-400',
    category: 'query',
    description: `Execute ${toolName}`,
  }
}

/**
 * Get the full registration for a tool (if exists)
 */
export function getToolRegistration(toolName: string): ToolRegistration | undefined {
  return toolRegistry.get(toolName)
}

/**
 * Check if a tool has a custom UI component registered
 */
export function hasCustomUI(toolName: string): boolean {
  return toolRegistry.get(toolName)?.component !== undefined
}

/**
 * Get all registered tool names
 */
export function getRegisteredTools(): string[] {
  return Array.from(toolRegistry.keys())
}

/**
 * Clear all registrations (useful for testing)
 */
export function clearRegistry(): void {
  toolRegistry.clear()
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get display name for a tool
 */
export function getToolDisplayName(toolName: string): string {
  return getToolConfig(toolName).displayName
}

/**
 * Get color class for a tool
 */
export function getToolColor(toolName: string): string {
  return getToolConfig(toolName).color
}

/**
 * Get category for a tool
 */
export function getToolCategory(toolName: string): ToolConfig['category'] {
  return getToolConfig(toolName).category
}

// =============================================================================
// BATCH REGISTRATION
// =============================================================================

/**
 * Register multiple tools at once
 *
 * @example
 * registerTools({
 *   unity_query: { config: {...}, component: QueryUI },
 *   unity_hierarchy: { config: {...}, component: HierarchyUI },
 * })
 */
export function registerTools(
  tools: Record<string, ToolRegistration>
): void {
  for (const [name, registration] of Object.entries(tools)) {
    registerToolUI(name, registration)
  }
}

// =============================================================================
// DEFAULT CONFIGS INITIALIZATION
// =============================================================================

/**
 * Initialize registry with default configs (no custom components yet)
 * Call this at app startup to ensure all known tools have configs
 */
export function initializeDefaultConfigs(): void {
  for (const [name, config] of Object.entries(defaultConfigs)) {
    if (!toolRegistry.has(name)) {
      toolRegistry.set(name, { config })
    }
  }
}

// Auto-initialize on module load
initializeDefaultConfigs()
