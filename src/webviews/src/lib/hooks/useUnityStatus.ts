import { useState, useEffect, useCallback } from 'react'
import VSCodeAPI from '../VSCodeAPI'

/**
 * Unity connection status returned from the agent service.
 */
export interface UnityStatus {
  /** Connection status: "connected" or "disconnected" */
  status: 'connected' | 'disconnected'
  /** Path to the connected Unity project, or null if disconnected */
  project: string | null
  /** Whether Unity is currently compiling scripts */
  compiling: boolean
  /** Number of active connections */
  connections: number
}

/**
 * Derived status for the UI indicator.
 */
export type ConnectionState = 'connected' | 'compiling' | 'disconnected' | 'error'

interface UseUnityStatusOptions {
  /** Polling interval in milliseconds (default: 2000) */
  pollInterval?: number
  /** Whether polling is enabled (default: true) */
  enabled?: boolean
}

interface UseUnityStatusReturn {
  /** Raw status from the backend */
  status: UnityStatus | null
  /** Derived connection state for UI */
  connectionState: ConnectionState
  /** Whether the initial fetch is still loading */
  isLoading: boolean
  /** Error message if fetch failed */
  error: string | null
  /** Manually trigger a status refresh */
  refresh: () => void
}

/**
 * Hook to get Unity connection status via VS Code postMessage.
 *
 * Sends 'getUnityStatus' message to extension and receives 'unityStatus' response.
 * Polls at the specified interval.
 *
 * @example
 * ```tsx
 * const { connectionState, status } = useUnityStatus()
 *
 * // connectionState is one of: 'connected' | 'compiling' | 'disconnected' | 'error'
 * // status contains full details: { status, project, compiling, connections }
 * ```
 */
export function useUnityStatus({
  pollInterval = 2000,
  enabled = true,
}: UseUnityStatusOptions = {}): UseUnityStatusReturn {
  const [status, setStatus] = useState<UnityStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const requestStatus = useCallback(() => {
    VSCodeAPI.postMessage({ type: 'getUnityStatus' })
  }, [])

  // Listen for status responses from extension
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleMessage = (event: MessageEvent) => {
      const message = event.data

      if (message.type === 'unityStatus') {
        setStatus(message.status)
        setError(null)
        setIsLoading(false)
      } else if (message.type === 'unityStatusError') {
        setError(message.error || 'Failed to get Unity status')
        setIsLoading(false)
      }
    }

    window.addEventListener('message', handleMessage)

    // Request immediately on mount
    requestStatus()

    // Set up polling interval
    const intervalId = setInterval(requestStatus, pollInterval)

    return () => {
      window.removeEventListener('message', handleMessage)
      clearInterval(intervalId)
    }
  }, [requestStatus, pollInterval, enabled])

  // Derive the connection state for UI
  const connectionState: ConnectionState = (() => {
    if (error) return 'error'
    if (!status) return 'disconnected'
    if (status.status === 'disconnected') return 'disconnected'
    if (status.compiling) return 'compiling'
    return 'connected'
  })()

  return {
    status,
    connectionState,
    isLoading,
    error,
    refresh: requestStatus,
  }
}
