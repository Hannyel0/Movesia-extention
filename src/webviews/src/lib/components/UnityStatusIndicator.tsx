import { useUnityStatus, type ConnectionState } from '../hooks/useUnityStatus'
import { cn } from '../utils'

// Unity logo as inline SVG component for proper styling
function UnityLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1488 1681"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m1487.5 1176.1v-784.1l-679-392v301l266 154c10.5 7 10.5 21.1 0 24.6l-315 182c-10.5 7-21 3.5-28 0l-315-182c-10.5-3.5-10.5-21.1 0-24.6l266-154v-301l-682.5 392v784.1-3.5 3.5l259-150.5v-308c0-10.5 14-17.5 21-14l315 182c10.5 7 14 14 14 24.5v364c0 10.5-14 17.5-21 14l-266-154-259 150.5 679 395.6 679-392.1-259-150.5-266 154c-10.5 7-21 0-21-14v-364c0-10.5 7-21 14-24.5l315-182c10.5-7 21 0 21 14v308z" />
    </svg>
  )
}

// Status indicator dot colors
const statusColors: Record<ConnectionState, string> = {
  connected: 'bg-green-500',
  compiling: 'bg-yellow-500',
  disconnected: 'bg-red-500',
  error: 'bg-red-500',
}

// Status indicator dot animation
const statusAnimation: Record<ConnectionState, string> = {
  connected: '',
  compiling: 'animate-pulse',
  disconnected: '',
  error: '',
}

// Tooltip text for each state
const statusTooltip: Record<ConnectionState, string> = {
  connected: 'Unity connected',
  compiling: 'Unity compiling...',
  disconnected: 'Unity disconnected',
  error: 'Connection error',
}

interface UnityStatusIndicatorProps {
  /** Custom class name for the container */
  className?: string
  /** API base URL (default: http://127.0.0.1:8765) */
  apiBaseUrl?: string
  /** Polling interval in ms (default: 2000) */
  pollInterval?: number
}

/**
 * Unity connection status indicator with logo and colored dot.
 *
 * Shows:
 * - 🟢 Green: Connected to Unity
 * - 🟡 Yellow (pulsing): Unity is compiling
 * - 🔴 Red: Disconnected or error
 *
 * Hover to see project path and detailed status.
 */
export function UnityStatusIndicator({
  className,
  apiBaseUrl,
  pollInterval = 2000,
}: UnityStatusIndicatorProps) {
  const { status, connectionState, isLoading } = useUnityStatus({
    apiBaseUrl,
    pollInterval,
  })

  // Build tooltip with project info if available
  const tooltipText = (() => {
    const baseText = statusTooltip[connectionState]
    if (status?.project && connectionState === 'connected') {
      // Extract just the project folder name from the full path
      const projectName = status.project.split(/[/\\]/).pop() || status.project
      return `${baseText}: ${projectName}`
    }
    if (connectionState === 'compiling' && status?.project) {
      const projectName = status.project.split(/[/\\]/).pop() || status.project
      return `Compiling: ${projectName}`
    }
    return baseText
  })()

  return (
    <div
      className={cn(
        'relative flex items-center justify-center w-8 h-8 rounded-lg',
        'hover:bg-vscode-toolbar-hoverBackground transition-colors',
        'cursor-default',
        className
      )}
      title={tooltipText}
    >
      {/* Unity Logo */}
      <UnityLogo
        className={cn(
          'w-4 h-4 transition-opacity',
          isLoading ? 'opacity-50' : 'opacity-80',
          connectionState === 'connected' && 'text-vscode-foreground',
          connectionState === 'compiling' && 'text-yellow-500',
          connectionState === 'disconnected' && 'text-vscode-descriptionForeground',
          connectionState === 'error' && 'text-vscode-descriptionForeground'
        )}
      />

      {/* Status Dot - positioned at bottom-right corner */}
      <span
        className={cn(
          'absolute bottom-1 right-1 w-2 h-2 rounded-full',
          'ring-1 ring-vscode-editor-background',
          statusColors[connectionState],
          statusAnimation[connectionState]
        )}
      />
    </div>
  )
}
