import { useState, useEffect, useCallback } from 'react'

/**
 * Unity connection status returned from the backend.
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
  /** Base URL for the API (default: http://127.0.0.1:8765) */
  apiBaseUrl?: string
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
  refresh: () => Promise<void>
}

/**
 * Hook to poll Unity connection status from the backend.
 *
 * Polls the /unity/status endpoint every `pollInterval` ms and returns
 * the connection state for rendering a status indicator.
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
  apiBaseUrl = 'http://127.0.0.1:8765',
  pollInterval = 2000,
  enabled = true,
}: UseUnityStatusOptions = {}): UseUnityStatusReturn {
  const [status, setStatus] = useState<UnityStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/unity/status`)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data: UnityStatus = await response.json()
      setStatus(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status')
      // Keep the last known status on error, but mark as error state
    } finally {
      setIsLoading(false)
    }
  }, [apiBaseUrl])

  // Initial fetch and polling
  useEffect(() => {
    if (!enabled) {
      return
    }

    // Fetch immediately on mount
    fetchStatus()

    // Set up polling interval
    const intervalId = setInterval(fetchStatus, pollInterval)

    return () => {
      clearInterval(intervalId)
    }
  }, [fetchStatus, pollInterval, enabled])

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
    refresh: fetchStatus,
  }
}
