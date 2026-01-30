/**
 * Default Tool UI Component
 *
 * This is the fallback UI used when no custom component is registered for a tool.
 * It displays the tool input/output as formatted JSON with collapsible sections.
 *
 * Custom tool UIs should implement the same ToolUIProps interface.
 */

import React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../utils'
import type { ToolUIProps } from './types'

/**
 * Format data as pretty-printed JSON
 */
function formatJson(data: unknown): string {
  if (data === undefined || data === null) return ''
  if (typeof data === 'string') {
    try {
      return JSON.stringify(JSON.parse(data), null, 2)
    } catch {
      return data
    }
  }
  return JSON.stringify(data, null, 2)
}

/**
 * Default tool UI - displays input/output as JSON
 */
export function DefaultToolUI({ tool, input, output, isActive }: ToolUIProps) {
  return (
    <div className="space-y-3">
      {/* Input Section */}
      {input !== undefined && (
        <div>
          <div className="text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1.5 uppercase tracking-wide">
            Input
          </div>
          <pre
            className={cn(
              'text-xs p-2.5 rounded-md overflow-x-auto',
              'bg-[var(--vscode-textCodeBlock-background)] border border-[var(--vscode-panel-border)]',
              'text-[var(--vscode-editor-foreground)] font-mono'
            )}
          >
            {formatJson(input)}
          </pre>
        </div>
      )}

      {/* Output Section */}
      {output !== undefined && (
        <div>
          <div className="text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1.5 uppercase tracking-wide">
            Output
          </div>
          <pre
            className={cn(
              'text-xs p-2.5 rounded-md overflow-x-auto max-h-48 overflow-y-auto',
              'bg-[var(--vscode-textCodeBlock-background)] border border-[var(--vscode-panel-border)]',
              'text-[var(--vscode-editor-foreground)] font-mono'
            )}
          >
            {formatJson(output)}
          </pre>
        </div>
      )}

      {/* Error Section */}
      {tool.error && (
        <div>
          <div className="text-xs font-medium text-[var(--vscode-errorForeground)] mb-1.5 uppercase tracking-wide">
            Error
          </div>
          <pre
            className={cn(
              'text-xs p-2.5 rounded-md overflow-x-auto',
              'bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)]',
              'text-[var(--vscode-errorForeground)] font-mono'
            )}
          >
            {tool.error}
          </pre>
        </div>
      )}

      {/* Loading state when no output yet */}
      {isActive && output === undefined && !tool.error && (
        <div className="flex items-center gap-2 text-xs text-[var(--vscode-descriptionForeground)]">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Executing...</span>
        </div>
      )}
    </div>
  )
}

export default DefaultToolUI
