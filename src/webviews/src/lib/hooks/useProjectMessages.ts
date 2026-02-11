import { useEffect, useCallback, useRef } from 'react'
import VSCodeAPI from '../VSCodeAPI'
import type { ProjectMessageType, ProjectResponseType } from '../types/project'

type MessageHandler = (response: ProjectResponseType) => void

/**
 * Hook for communicating with the extension about Unity projects.
 * Sends messages and listens for responses.
 */
export function useProjectMessages(onMessage: MessageHandler) {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ProjectResponseType
      // Filter for project-related messages
      if (
        message.type === 'unityProjects' ||
        message.type === 'unityProjectsLoading' ||
        message.type === 'unityProjectsError' ||
        message.type === 'packageStatus' ||
        message.type === 'packageInstalling' ||
        message.type === 'packageInstallComplete' ||
        message.type === 'selectedProject' ||
        message.type === 'browseResult' ||
        message.type === 'unityRunningStatus'
      ) {
        onMessageRef.current(message)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const sendMessage = useCallback((message: ProjectMessageType) => {
    VSCodeAPI.postMessage(message)
  }, [])

  const getUnityProjects = useCallback(() => {
    sendMessage({ type: 'getUnityProjects' })
  }, [sendMessage])

  const checkPackageStatus = useCallback(
    (projectPath: string) => {
      sendMessage({ type: 'checkPackageStatus', projectPath })
    },
    [sendMessage]
  )

  const installPackage = useCallback(
    (projectPath: string) => {
      sendMessage({ type: 'installPackage', projectPath })
    },
    [sendMessage]
  )

  const setSelectedProject = useCallback(
    (projectPath: string) => {
      sendMessage({ type: 'setSelectedProject', projectPath })
    },
    [sendMessage]
  )

  const getSelectedProject = useCallback(() => {
    sendMessage({ type: 'getSelectedProject' })
  }, [sendMessage])

  const browseForProject = useCallback(() => {
    sendMessage({ type: 'browseForProject' })
  }, [sendMessage])

  const clearSelectedProject = useCallback(() => {
    sendMessage({ type: 'clearSelectedProject' })
  }, [sendMessage])

  const checkUnityRunning = useCallback(
    (projectPath: string) => {
      sendMessage({ type: 'checkUnityRunning', projectPath })
    },
    [sendMessage]
  )

  return {
    getUnityProjects,
    checkPackageStatus,
    installPackage,
    setSelectedProject,
    getSelectedProject,
    browseForProject,
    clearSelectedProject,
    checkUnityRunning,
  }
}
