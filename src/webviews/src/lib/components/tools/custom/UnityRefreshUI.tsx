/**
 * Custom Tool UI for unity_refresh
 *
 * Shows compilation progress and verification results.
 * This tool triggers Unity's asset database refresh and waits for compilation.
 */

import React from 'react'
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  FileCode,
  Loader2,
} from 'lucide-react'
import { cn } from '../../../utils'
import type { ToolUIProps, UnityRefresh } from '../types'

// =============================================================================
// STATUS CONFIGS
// =============================================================================

interface StatusConfig {
  icon: React.ComponentType<{ className?: string }>
  color: string
  bgColor: string
  label: string
}

const STATUS_CONFIGS: Record<string, StatusConfig> = {
  SUCCESS: {
    icon: CheckCircle2,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    label: 'Compilation Successful',
  },
  FAILED: {
    icon: XCircle,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    label: 'Compilation Failed',
  },
  TIMEOUT: {
    icon: Clock,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    label: 'Compilation Timeout',
  },
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Parse tool output into typed data.
 * Handles JSON strings and already-parsed objects.
 */
function parseOutput(output: unknown): UnityRefresh.Output | undefined {
  if (!output) return undefined

  // Already an object - return as-is
  if (typeof output === 'object') {
    return output as UnityRefresh.Output
  }

  // JSON string - parse it
  if (typeof output === 'string') {
    try {
      return JSON.parse(output) as UnityRefresh.Output
    } catch {
      // Parse failed - return as error
      return { status: 'FAILED', message: output } as UnityRefresh.Output
    }
  }

  return output as UnityRefresh.Output
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function UnityRefreshUI({
  tool,
  input,
  output,
  isActive,
}: ToolUIProps<UnityRefresh.Input, UnityRefresh.Output>) {
  const typedInput = input as UnityRefresh.Input | undefined
  const typedOutput = React.useMemo(() => parseOutput(output), [output])

  // Show loading state
  if (isActive && !typedOutput) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-md bg-yellow-500/10">
        <RefreshCw className="w-5 h-5 text-yellow-400 animate-spin" />
        <div className="flex-1">
          <div className="text-sm font-medium">Refreshing Assets</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Waiting for Unity compilation...</span>
          </div>
          {typedInput?.watched_scripts && typedInput.watched_scripts.length > 0 && (
            <div className="mt-2 text-xs">
              <div className="text-muted-foreground mb-1">Watching scripts:</div>
              <div className="flex flex-wrap gap-1">
                {typedInput.watched_scripts.map((script, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 bg-[var(--vscode-badge-background)] rounded text-[10px]"
                  >
                    {script}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Show error
  if (tool.error) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-md bg-red-500/10">
        <AlertCircle className="w-5 h-5 text-red-400" />
        <div className="flex-1">
          <div className="text-sm font-medium text-red-400">Refresh Failed</div>
          <div className="text-xs text-red-300">{tool.error}</div>
        </div>
      </div>
    )
  }

  // Get status config
  const status = typedOutput?.status || 'SUCCESS'
  const config = STATUS_CONFIGS[status] || STATUS_CONFIGS.SUCCESS
  const Icon = config.icon

  return (
    <div className={cn('rounded-md overflow-hidden', config.bgColor)}>
      {/* Header */}
      <div className="flex items-center gap-3 p-3">
        <Icon className={cn('w-5 h-5', config.color)} />
        <div className="flex-1">
          <div className="text-sm font-medium">{config.label}</div>
          {typedOutput?.message && (
            <div className="text-xs text-muted-foreground">{typedOutput.message}</div>
          )}
        </div>
      </div>

      {/* Verification Results */}
      {typedOutput?.verification && Object.keys(typedOutput.verification).length > 0 && (
        <div className="px-3 pb-3">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">
            Script Verification
          </div>
          <div className="space-y-1">
            {Object.entries(typedOutput.verification).map(([script, verified]) => (
              <div
                key={script}
                className={cn(
                  'flex items-center gap-2 px-2 py-1 rounded text-xs',
                  verified
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-red-500/10 text-red-400'
                )}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span className="flex-1">{script}</span>
                {verified ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {typedOutput?.errors && typedOutput.errors.length > 0 && (
        <div className="px-3 pb-3">
          <div className="text-xs font-medium text-red-400 mb-1.5">Compilation Errors</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {typedOutput.errors.map((error, i) => (
              <div
                key={i}
                className="flex items-start gap-2 px-2 py-1 rounded bg-red-500/10 text-xs text-red-300"
              >
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                <span className="break-words">{error}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default UnityRefreshUI
