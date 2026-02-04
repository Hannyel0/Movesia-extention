import { useState, useEffect, useCallback, useRef } from 'react'
import VSCodeAPI from '../VSCodeAPI'
import type { ProjectResponseType } from '../types/project'

interface UseUnityRunningOptions {
  /** The project path to check */
  projectPath: string | null
  /** Polling interval in milliseconds (default: 2000) */
  pollInterval?: number
  /** Whether polling is enabled (default: true) */
  enabled?: boolean
}

interface UseUnityRunningReturn {
  /** Whether Unity has the project open (Temp folder exists) */
  isRunning: boolean
  /** Whether the initial check is still loading */
  isLoading: boolean
  /** Manually trigger a check */
  refresh: () => void
}

/**
 * Hook to poll whether Unity has a specific project open.
 *
 * Detects Unity by checking for the existence of the Temp folder,
 * which Unity creates when a project is open and removes when closed.
 *
 * @example
 * ```tsx
 * const { isRunning, isLoading } = useUnityRunning({
 *   projectPath: '/path/to/unity/project',
 *   pollInterval: 2000,
 * })
 * ```
 */
export function useUnityRunning({
  projectPath,
  pollInterval = 2000,
  enabled = true,
}: UseUnityRunningOptions): UseUnityRunningReturn {
  const [isRunning, setIsRunning] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ProjectResponseType
      if (
        message.type === 'unityRunningStatus' &&
        message.projectPath === projectPath
      ) {
        console.log('[useUnityRunning] Received response:', {
          projectPath: message.projectPath,
          isRunning: message.isRunning,
        })
        setIsRunning(message.isRunning)
        setIsLoading(false)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [projectPath])

  // Function to request a check
  const checkUnityRunning = useCallback(() => {
    if (!projectPath) return
    VSCodeAPI.postMessage({
      type: 'checkUnityRunning',
      projectPath,
    })
  }, [projectPath])

  // Initial check and optional polling
  useEffect(() => {
    if (!enabled || !projectPath) {
      // Only set loading to false if we were never enabled
      // Don't set to false if we're just waiting for a response
      if (!projectPath) {
        setIsLoading(false)
      }
      return
    }

    // Reset loading state when starting a check
    setIsLoading(true)
    console.log('[useUnityRunning] Starting check for:', projectPath)

    // Check immediately
    checkUnityRunning()

    // Set up polling interval only if pollInterval > 0
    if (pollInterval > 0) {
      intervalRef.current = setInterval(checkUnityRunning, pollInterval)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [checkUnityRunning, pollInterval, enabled, projectPath])

  return {
    isRunning,
    isLoading,
    refresh: checkUnityRunning,
  }
}
