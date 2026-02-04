/**
 * Types for Unity project management in the webview
 */

export interface UnityProjectInfo {
  path: string
  name: string
  editorVersion?: string
  movesiaInstalled: boolean
  movesiaVersion?: string
}

// Message types for webview <-> extension communication
export type ProjectMessageType =
  | { type: 'getUnityProjects' }
  | { type: 'checkPackageStatus'; projectPath: string }
  | { type: 'installPackage'; projectPath: string }
  | { type: 'setSelectedProject'; projectPath: string }
  | { type: 'getSelectedProject' }
  | { type: 'clearSelectedProject' }
  | { type: 'browseForProject' }
  | { type: 'checkUnityRunning'; projectPath: string }

// Response types from extension
export type ProjectResponseType =
  | { type: 'unityProjects'; projects: UnityProjectInfo[] }
  | { type: 'unityProjectsLoading' }
  | { type: 'unityProjectsError'; error: string }
  | { type: 'packageStatus'; projectPath: string; installed: boolean; version?: string }
  | { type: 'packageInstalling'; projectPath: string }
  | { type: 'packageInstallComplete'; projectPath: string; success: boolean; error?: string; version?: string }
  | { type: 'selectedProject'; projectPath: string | null }
  | { type: 'browseResult'; project: UnityProjectInfo | null }
  | { type: 'unityRunningStatus'; projectPath: string; isRunning: boolean }
