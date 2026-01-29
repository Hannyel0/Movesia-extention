import React from 'react'
import { ChevronRight, Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react'
import { cn } from '../utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

export type ToolCallState = 'streaming' | 'executing' | 'completed' | 'error'

export interface ToolCallData {
  id: string
  name: string
  state: ToolCallState
  input?: unknown
  output?: unknown
  error?: string
}

interface ToolCallProps {
  tool: ToolCallData
  defaultOpen?: boolean
}

// Tool name to friendly display name mapping
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  unity_query: 'Query Unity',
  unity_hierarchy: 'Modify Hierarchy',
  unity_component: 'Modify Component',
  unity_prefab: 'Prefab Operation',
  unity_scene: 'Scene Operation',
  unity_refresh: 'Refresh Assets',
}

// Tool name to icon color mapping
const TOOL_COLORS: Record<string, string> = {
  unity_query: 'text-blue-400',
  unity_hierarchy: 'text-green-400',
  unity_component: 'text-purple-400',
  unity_prefab: 'text-orange-400',
  unity_scene: 'text-cyan-400',
  unity_refresh: 'text-yellow-400',
}

function getToolDisplayName(name: string): string {
  return TOOL_DISPLAY_NAMES[name] || name.replace(/_/g, ' ')
}

function getToolColor(name: string): string {
  return TOOL_COLORS[name] || 'text-primary'
}

function StateIcon({ state }: { state: ToolCallState }) {
  switch (state) {
    case 'streaming':
    case 'executing':
      return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
    case 'error':
      return <XCircle className="w-3.5 h-3.5 text-red-400" />
  }
}

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

export function ToolCall({ tool, defaultOpen = true }: ToolCallProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen)
  const isActive = tool.state === 'streaming' || tool.state === 'executing'
  const toolColor = getToolColor(tool.name)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          'rounded-lg border overflow-hidden transition-colors',
          isActive
            ? 'border-blue-500/40 bg-[var(--vscode-editor-background)] shadow-sm'
            : tool.state === 'error'
              ? 'border-red-500/40 bg-[var(--vscode-editor-background)]'
              : 'border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)]'
        )}
      >
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-2 w-full px-3 py-2 text-left',
              'hover:bg-[var(--vscode-list-hoverBackground)] transition-colors',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary'
            )}
          >
            <ChevronRight
              className={cn(
                'w-4 h-4 text-muted-foreground transition-transform',
                isOpen && 'rotate-90'
              )}
            />
            <Wrench className={cn('w-4 h-4', toolColor)} />
            <span className="text-sm font-medium flex-1 truncate">
              {getToolDisplayName(tool.name)}
            </span>
            <StateIcon state={tool.state} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 pt-1 space-y-3 border-t border-[var(--vscode-panel-border)]">
            {/* Input Section */}
            {tool.input !== undefined && (
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
                  {formatJson(tool.input)}
                </pre>
              </div>
            )}

            {/* Output Section */}
            {tool.output !== undefined && (
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
                  {formatJson(tool.output)}
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
            {isActive && tool.output === undefined && (
              <div className="flex items-center gap-2 text-xs text-[var(--vscode-descriptionForeground)]">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Executing...</span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

interface ToolCallListProps {
  tools: ToolCallData[]
}

export function ToolCallList({ tools }: ToolCallListProps) {
  if (tools.length === 0) return null

  return (
    <div className="space-y-2 mb-3">
      {tools.map(tool => (
        <ToolCall key={tool.id} tool={tool} defaultOpen={true} />
      ))}
    </div>
  )
}
