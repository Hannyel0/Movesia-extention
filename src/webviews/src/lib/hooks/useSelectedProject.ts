import { useState, useEffect, useCallback } from 'react'
import VSCodeAPI from '../VSCodeAPI'
import type { ProjectResponseType } from '../types/project'

interface UseSelectedProjectReturn {
  /** The currently selected project path, or null if none */
  projectPath: string | null
  /** Whether the initial fetch is still loading */
  isLoading: boolean
  /** Manually refresh the selected project */
  refresh: () => void
}

/**
 * Hook to get the currently selected Unity project from extension storage.
 *
 * @example
 * ```tsx
 * const { projectPath, isLoading } = useSelectedProject()
 * ```
 */
export function useSelectedProject(): UseSelectedProjectReturn {
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ProjectResponseType
      if (message.type === 'selectedProject') {
        setProjectPath(message.projectPath)
        setIsLoading(false)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Function to request the selected project
  const getSelectedProject = useCallback(() => {
    VSCodeAPI.postMessage({ type: 'getSelectedProject' })
  }, [])

  // Fetch on mount
  useEffect(() => {
    getSelectedProject()
  }, [getSelectedProject])

  return {
    projectPath,
    isLoading,
    refresh: getSelectedProject,
  }
}
