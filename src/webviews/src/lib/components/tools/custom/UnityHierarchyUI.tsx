/**
 * Custom Tool UI for unity_hierarchy
 *
 * Provides visual feedback for hierarchy manipulation actions:
 * - create: Shows what was created
 * - duplicate: Shows the clone
 * - destroy: Shows what was removed
 * - rename: Shows old -> new name
 * - reparent: Shows the move
 * - move_scene: Shows scene transfer
 */

import React from 'react'
import {
  Plus,
  Copy,
  Trash2,
  Edit3,
  Move,
  ArrowRightLeft,
  Box,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { cn } from '../../../utils'
import type { ToolUIProps, UnityHierarchy } from '../types'

// =============================================================================
// ACTION CONFIGS
// =============================================================================

interface ActionConfig {
  icon: React.ComponentType<{ className?: string }>
  color: string
  bgColor: string
  label: string
  verb: string
}

const ACTION_CONFIGS: Record<UnityHierarchy.Action, ActionConfig> = {
  create: {
    icon: Plus,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    label: 'Create',
    verb: 'Created',
  },
  duplicate: {
    icon: Copy,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    label: 'Duplicate',
    verb: 'Duplicated',
  },
  destroy: {
    icon: Trash2,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    label: 'Destroy',
    verb: 'Destroyed',
  },
  rename: {
    icon: Edit3,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    label: 'Rename',
    verb: 'Renamed',
  },
  reparent: {
    icon: Move,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    label: 'Reparent',
    verb: 'Moved',
  },
  move_scene: {
    icon: ArrowRightLeft,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    label: 'Move Scene',
    verb: 'Transferred',
  },
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Parse tool output into typed data.
 * Handles JSON strings and already-parsed objects.
 */
function parseOutput(output: unknown): UnityHierarchy.Output | undefined {
  if (!output) return undefined

  // Already an object - return as-is
  if (typeof output === 'object') {
    return output as UnityHierarchy.Output
  }

  // JSON string - parse it
  if (typeof output === 'string') {
    try {
      return JSON.parse(output) as UnityHierarchy.Output
    } catch {
      // Parse failed - return as error
      return { error: output } as UnityHierarchy.Output
    }
  }

  return output as UnityHierarchy.Output
}

export function UnityHierarchyUI({
  tool,
  input,
  output,
  isActive,
}: ToolUIProps<UnityHierarchy.Input, UnityHierarchy.Output>) {
  const typedInput = input as UnityHierarchy.Input | undefined
  const typedOutput = React.useMemo(() => parseOutput(output), [output])

  const action = typedInput?.action || 'create'
  const config = ACTION_CONFIGS[action]
  const Icon = config.icon

  // Show loading state
  if (isActive && !typedOutput) {
    return (
      <div className={cn('flex items-center gap-3 p-3 rounded-md', config.bgColor)}>
        <Icon className={cn('w-5 h-5', config.color)} />
        <div className="flex-1">
          <div className="text-sm font-medium">{config.label}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Processing...</span>
          </div>
        </div>
      </div>
    )
  }

  // Check for explicit errors only:
  // 1. tool.error is set, OR
  // 2. output explicitly has success === false, OR
  // 3. output has an error field without a success field
  const hasExplicitError = tool.error ||
    (typedOutput && typedOutput.success === false) ||
    (typedOutput && typedOutput.error && typedOutput.success === undefined)

  if (hasExplicitError) {
    const errorMsg = tool.error || typedOutput?.error || 'Unknown error'
    return (
      <div className="flex items-center gap-3 p-3 rounded-md bg-red-500/10">
        <AlertCircle className="w-5 h-5 text-red-400" />
        <div className="flex-1">
          <div className="text-sm font-medium text-red-400">{config.label} Failed</div>
          <div className="text-xs text-red-300">{errorMsg}</div>
        </div>
      </div>
    )
  }

  // Show success
  return (
    <div className={cn('flex items-center gap-3 p-3 rounded-md', config.bgColor)}>
      <Icon className={cn('w-5 h-5', config.color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{config.verb}</span>
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
        </div>
        {renderActionDetails(action, typedInput, typedOutput)}
      </div>
    </div>
  )
}

// =============================================================================
// ACTION DETAILS
// =============================================================================

function renderActionDetails(
  action: UnityHierarchy.Action,
  input: UnityHierarchy.Input | undefined,
  output: UnityHierarchy.Output | undefined
): React.ReactNode {
  if (!output) return null

  switch (action) {
    case 'create':
      return (
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div className="flex items-center gap-1.5">
            <Box className="w-3 h-3 text-blue-400" />
            <span className="font-medium">{output.name || input?.name || 'GameObject'}</span>
            {input?.primitive_type && (
              <span className="text-[10px] px-1 py-0.5 bg-[var(--vscode-badge-background)] rounded">
                {input.primitive_type}
              </span>
            )}
          </div>
          {output.instanceId && <div>ID: #{output.instanceId}</div>}
          {input?.position && (
            <div>
              Position: ({input.position[0]}, {input.position[1]}, {input.position[2]})
            </div>
          )}
        </div>
      )

    case 'duplicate':
      return (
        <div className="text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Box className="w-3 h-3 text-blue-400" />
            <span>Clone created</span>
            {output.instanceId && <span>• ID: #{output.instanceId}</span>}
          </div>
        </div>
      )

    case 'destroy':
      return (
        <div className="text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span>Object removed</span>
            {input?.instance_id && <span>• ID: #{input.instance_id}</span>}
          </div>
          <div className="text-[10px] mt-0.5">(Undo available)</div>
        </div>
      )

    case 'rename':
      return (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Box className="w-3 h-3 text-blue-400" />
          <span className="font-medium">{input?.name}</span>
          {input?.instance_id && <span>• ID: #{input.instance_id}</span>}
        </div>
      )

    case 'reparent':
      return (
        <div className="text-xs text-muted-foreground">
          <div>Object #{input?.instance_id}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span>→</span>
            {input?.parent_id ? (
              <span>Parent #{input.parent_id}</span>
            ) : (
              <span>Root level</span>
            )}
          </div>
        </div>
      )

    case 'move_scene':
      return (
        <div className="text-xs text-muted-foreground">
          <div>Object #{input?.instance_id}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span>→</span>
            <span className="font-medium">{input?.target_scene}</span>
          </div>
        </div>
      )

    default:
      return null
  }
}

export default UnityHierarchyUI
