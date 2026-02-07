/**
 * Custom Tool UI for unity_query
 *
 * Provides specialized rendering for different query actions:
 * - hierarchy: Interactive tree view
 * - inspect_object: Property grid
 * - search_assets: Asset list with icons
 * - get_logs: Colored log entries
 * - get_settings: Settings display
 */

import React, { useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Box,
  Search,
  AlertCircle,
  AlertTriangle,
  Info,
  Settings,
  Eye,
  Loader2,
  FileCode,
  Folder,
  File,
} from 'lucide-react'
import { cn } from '../../../utils'
import type { ToolUIProps, UnityQuery } from '../types'

// =============================================================================
// HIERARCHY VIEW
// =============================================================================

interface HierarchyNodeProps {
  node: UnityQuery.HierarchyNode
  depth?: number
}

function HierarchyNodeItem({ node, depth = 0 }: HierarchyNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2)
  const hasChildren = node.children && node.children.length > 0

  return (
    <div className="select-none">
      <div
        className={cn(
          'flex items-center gap-1 py-0.5 px-1 rounded hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer',
          !node.activeSelf && 'opacity-50'
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Box className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span className="text-xs truncate">{node.name}</span>
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
          #{node.instanceId}
        </span>
      </div>
      {isExpanded && hasChildren && (
        <div>
          {node.children!.map((child, i) => (
            <HierarchyNodeItem key={child.instanceId || i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function HierarchyView({ output }: { output: UnityQuery.HierarchyOutput }) {
  if (!output.scenes || output.scenes.length === 0) {
    return <div className="text-xs text-muted-foreground">No scenes loaded</div>
  }

  return (
    <div className="space-y-2">
      {output.scenes.map((scene, i) => (
        <div key={scene.path || i}>
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1">
            <Folder className="w-3.5 h-3.5" />
            <span>{scene.name}</span>
            {scene.isActive && (
              <span className="text-[10px] px-1 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                Active
              </span>
            )}
          </div>
          <div className="border border-[var(--vscode-panel-border)] rounded-md p-1 bg-[var(--vscode-textCodeBlock-background)] max-h-64 overflow-y-auto">
            {scene.rootObjects.map((obj, j) => (
              <HierarchyNodeItem key={obj.instanceId || j} node={obj} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// =============================================================================
// INSPECT VIEW
// =============================================================================

function InspectView({ output }: { output: UnityQuery.InspectOutput }) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Box className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium">{output.name}</span>
        <span className="text-xs text-muted-foreground">#{output.instanceId}</span>
      </div>

      {/* Properties */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="text-muted-foreground">Tag</div>
        <div>{output.tag || 'Untagged'}</div>
        <div className="text-muted-foreground">Layer</div>
        <div>{output.layer || 'Default'}</div>
        <div className="text-muted-foreground">Active</div>
        <div>{output.isActive ? 'Yes' : 'No'}</div>
      </div>

      {/* Components */}
      {output.components && output.components.length > 0 && (
        <div>
          <div className="text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1.5 uppercase tracking-wide">
            Components ({output.components.length})
          </div>
          <div className="space-y-1.5">
            {output.components.map((comp, i) => (
              <ComponentItem key={i} component={comp} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ComponentItem({ component }: { component: UnityQuery.ComponentData }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasProperties = Object.keys(component.properties || {}).length > 0

  return (
    <div className="border border-[var(--vscode-panel-border)] rounded-md overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {hasProperties ? (
          isExpanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )
        ) : (
          <span className="w-3" />
        )}
        <FileCode className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-xs">{component.type}</span>
      </button>
      {isExpanded && hasProperties && (
        <div className="px-2 pb-2 pt-1 border-t border-[var(--vscode-panel-border)]">
          <pre className="text-[10px] font-mono text-muted-foreground overflow-x-auto">
            {JSON.stringify(component.properties, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// SEARCH VIEW
// =============================================================================

function SearchView({ output }: { output: UnityQuery.SearchOutput }) {
  if (!output.assets || output.assets.length === 0) {
    return <div className="text-xs text-muted-foreground">No assets found</div>
  }

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">
        Found {output.count || output.assets.length} assets
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {output.assets.map((asset, i) => (
          <div
            key={asset.guid || i}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--vscode-list-hoverBackground)]"
          >
            <AssetIcon type={asset.type} />
            <div className="flex-1 min-w-0">
              <div className="text-xs truncate">{asset.name}</div>
              <div className="text-[10px] text-muted-foreground truncate">{asset.path}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AssetIcon({ type }: { type: string }) {
  const lowerType = type.toLowerCase()
  if (lowerType.includes('prefab')) {
    return <Box className="w-3.5 h-3.5 text-blue-400 shrink-0" />
  }
  if (lowerType.includes('script') || lowerType.includes('mono')) {
    return <FileCode className="w-3.5 h-3.5 text-green-400 shrink-0" />
  }
  return <File className="w-3.5 h-3.5 text-gray-400 shrink-0" />
}

// =============================================================================
// LOGS VIEW
// =============================================================================

function LogsView({ output }: { output: UnityQuery.LogsOutput }) {
  if (!output.logs || output.logs.length === 0) {
    return <div className="text-xs text-muted-foreground">No logs found</div>
  }

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">
        {output.count || output.logs.length} log entries
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {output.logs.map((log, i) => (
          <LogEntry key={i} log={log} />
        ))}
      </div>
    </div>
  )
}

function LogEntry({ log }: { log: UnityQuery.LogEntry }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const getLogStyle = () => {
    switch (log.type) {
      case 'Error':
      case 'Exception':
        return { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' }
      case 'Warning':
        return { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10' }
      default:
        return { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10' }
    }
  }

  const style = getLogStyle()
  const Icon = style.icon

  return (
    <div
      className={cn('rounded-md overflow-hidden', style.bg)}
      onClick={() => log.stackTrace && setIsExpanded(!isExpanded)}
    >
      <div className="flex items-start gap-2 px-2 py-1.5 cursor-pointer">
        <Icon className={cn('w-3.5 h-3.5 shrink-0 mt-0.5', style.color)} />
        <div className="flex-1 min-w-0">
          <div className="text-xs break-words">{log.message}</div>
          {log.timestamp && (
            <div className="text-[10px] text-muted-foreground mt-0.5">{log.timestamp}</div>
          )}
        </div>
      </div>
      {isExpanded && log.stackTrace && (
        <pre className="px-2 pb-2 text-[10px] font-mono text-muted-foreground overflow-x-auto">
          {log.stackTrace}
        </pre>
      )}
    </div>
  )
}

// =============================================================================
// SETTINGS VIEW (fallback to JSON for now)
// =============================================================================

function SettingsView({ output }: { output: unknown }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Settings className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-medium">Project Settings</span>
      </div>
      <pre className="text-xs p-2 rounded-md bg-[var(--vscode-textCodeBlock-background)] border border-[var(--vscode-panel-border)] overflow-x-auto max-h-48 overflow-y-auto font-mono">
        {JSON.stringify(output, null, 2)}
      </pre>
    </div>
  )
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Parse tool output into typed data.
 * Handles JSON strings and already-parsed objects.
 */
function parseOutput(output: unknown): UnityQuery.Output | undefined {
  if (!output) return undefined

  if (typeof output === 'string') {
    try {
      return JSON.parse(output) as UnityQuery.Output
    } catch {
      return { error: output } as UnityQuery.Output
    }
  }

  if (typeof output === 'object') {
    return output as UnityQuery.Output
  }

  return output as UnityQuery.Output
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function UnityQueryUI({ tool, input, output, isActive }: ToolUIProps<UnityQuery.Input, UnityQuery.Output>) {
  const typedInput = input as UnityQuery.Input | undefined
  const typedOutput = React.useMemo(() => parseOutput(output), [output])

  // Show input summary
  const renderInputSummary = () => {
    if (!typedInput || !typedInput.action) return null

    const actionIcons: Record<string, React.ReactNode> = {
      hierarchy: <Box className="w-3.5 h-3.5 text-blue-400" />,
      inspect_object: <Eye className="w-3.5 h-3.5 text-purple-400" />,
      search_assets: <Search className="w-3.5 h-3.5 text-green-400" />,
      get_logs: <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />,
      get_settings: <Settings className="w-3.5 h-3.5 text-cyan-400" />,
    }

    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        {actionIcons[typedInput.action]}
        <span className="capitalize">{typedInput.action.replace(/_/g, ' ')}</span>
        {typedInput.instance_id && <span>• ID: {typedInput.instance_id}</span>}
        {typedInput.search_query && <span>• "{typedInput.search_query}"</span>}
        {typedInput.max_depth && typedInput.action === 'hierarchy' && (
          <span>• Depth: {typedInput.max_depth}</span>
        )}
      </div>
    )
  }

  // Show loading state
  if (isActive && !typedOutput) {
    return (
      <div>
        {renderInputSummary()}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Querying Unity...</span>
        </div>
      </div>
    )
  }

  // Show error
  if (tool.error || (typedOutput && 'error' in typedOutput && typedOutput.error)) {
    const errorMsg = tool.error || (typedOutput as { error: string })?.error
    return (
      <div>
        {renderInputSummary()}
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{errorMsg}</span>
        </div>
      </div>
    )
  }

  // Render based on action type
  if (!typedOutput) return null

  return (
    <div>
      {renderInputSummary()}
      {typedInput?.action === 'hierarchy' && 'scenes' in typedOutput && (
        <HierarchyView output={typedOutput as UnityQuery.HierarchyOutput} />
      )}
      {typedInput?.action === 'inspect_object' && 'components' in typedOutput && (
        <InspectView output={typedOutput as UnityQuery.InspectOutput} />
      )}
      {typedInput?.action === 'search_assets' && 'assets' in typedOutput && (
        <SearchView output={typedOutput as UnityQuery.SearchOutput} />
      )}
      {typedInput?.action === 'get_logs' && 'logs' in typedOutput && (
        <LogsView output={typedOutput as UnityQuery.LogsOutput} />
      )}
      {typedInput?.action === 'get_settings' && (
        <SettingsView output={typedOutput} />
      )}
    </div>
  )
}

export default UnityQueryUI
