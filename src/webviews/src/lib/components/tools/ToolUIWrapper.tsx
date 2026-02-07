/**
 * Tool UI Wrapper Component
 *
 * This component provides the standard wrapper/chrome around all tool UIs:
 * - Collapsible header with tool name and state icon
 * - Border styling based on state
 * - Expansion toggle
 *
 * It delegates the content rendering to either:
 * - A custom registered component for that tool
 * - The DefaultToolUI fallback
 */

import React, { Component, useState } from 'react'
import { ChevronRight, Loader2, CheckCircle2, XCircle, Wrench, AlertTriangle } from 'lucide-react'
import { cn } from '../../utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { getToolUIComponent, getToolConfig } from './registry'
import { DefaultToolUI } from './DefaultToolUI'
import type { ToolCallData, ToolCallState, ToolUIProps } from './types'

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface StateIconProps {
  state: ToolCallState
}

function StateIcon({ state }: StateIconProps) {
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

// =============================================================================
// ERROR BOUNDARY
// =============================================================================

interface ToolErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ToolErrorBoundary extends Component<
  { children: React.ReactNode; toolName: string },
  ToolErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; toolName: string }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ToolErrorBoundaryState {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center gap-2 text-xs text-red-400 p-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Failed to render {this.props.toolName}: {this.state.error?.message}</span>
        </div>
      )
    }
    return this.props.children
  }
}

// =============================================================================
// MAIN WRAPPER COMPONENT
// =============================================================================

export interface ToolUIWrapperProps {
  /** The tool call data to render */
  tool: ToolCallData
  /** Default expansion state */
  defaultOpen?: boolean
}

/**
 * Wrapper component that provides the standard tool UI chrome
 * and delegates content to the appropriate tool UI component.
 */
export function ToolUIWrapper({ tool, defaultOpen = true }: ToolUIWrapperProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const isActive = tool.state === 'streaming' || tool.state === 'executing'
  const config = getToolConfig(tool.name)
  const CustomComponent = getToolUIComponent(tool.name)

  // Build props for the tool UI component
  const uiProps: ToolUIProps = {
    tool,
    input: tool.input,
    output: tool.output,
    isExpanded: isOpen,
    onToggleExpand: () => setIsOpen(prev => !prev),
    isActive,
  }

  // Get the icon component (custom or default Wrench)
  const IconComponent = config.icon || Wrench

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
        {/* Header - Always visible */}
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
            <IconComponent className={cn('w-4 h-4', config.color)} />
            <span className="text-sm font-medium flex-1 truncate">
              {config.displayName}
            </span>
            <StateIcon state={tool.state} />
          </button>
        </CollapsibleTrigger>

        {/* Content - Collapsible */}
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-1 border-t border-[var(--vscode-panel-border)]">
            <ToolErrorBoundary toolName={config.displayName}>
              {CustomComponent ? (
                <CustomComponent {...uiProps} />
              ) : (
                <DefaultToolUI {...uiProps} />
              )}
            </ToolErrorBoundary>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

// =============================================================================
// LIST COMPONENT
// =============================================================================

export interface ToolUIListProps {
  /** Array of tool calls to render */
  tools: ToolCallData[]
  /** Default expansion state for all tools */
  defaultOpen?: boolean
}

/**
 * Renders a list of tool UI components
 */
export function ToolUIList({ tools, defaultOpen = true }: ToolUIListProps) {
  if (tools.length === 0) return null

  return (
    <div className="space-y-2 mb-3">
      {tools.map(tool => (
        <ToolUIWrapper key={tool.id} tool={tool} defaultOpen={defaultOpen} />
      ))}
    </div>
  )
}

export default ToolUIWrapper
