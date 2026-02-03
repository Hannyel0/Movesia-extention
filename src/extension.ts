import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { NextWebviewPanel } from './NextWebview'
import {
  createInstaller,
  type InstallResult,
  type InstalledPackageInfo,
} from './services/unity-package-installer'
import {
  findUnityProjects,
  isUnityProject,
  type UnityProject,
} from './services/unity-project-scanner'

// Types for webview messages
interface UnityProjectInfo {
  path: string
  name: string
  editorVersion?: string
  movesiaInstalled: boolean
  movesiaVersion?: string
}

type WebviewMessage =
  | { type: 'getUnityProjects' }
  | { type: 'checkPackageStatus'; projectPath: string }
  | { type: 'installPackage'; projectPath: string }
  | { type: 'setSelectedProject'; projectPath: string }
  | { type: 'getSelectedProject' }
  | { type: 'browseForProject' }
  | { type: 'checkUnityRunning'; projectPath: string }

export function activate(context: vscode.ExtensionContext) {
  const installer = createInstaller(context.extensionPath)

  // Key for storing selected project in workspace state
  const SELECTED_PROJECT_KEY = 'movesia.selectedProject'

  /**
   * Handle messages from the webview
   */
  async function handleWebviewMessage(
    message: WebviewMessage,
    postMessage: (msg: any) => void
  ) {
    console.log('[Extension] Received message from webview:', message)

    switch (message.type) {
      case 'getUnityProjects': {
        postMessage({ type: 'unityProjectsLoading' })
        try {
          const projects = await findUnityProjects()
          // Check installation status for each project
          const projectsWithStatus: UnityProjectInfo[] = await Promise.all(
            projects.map(async (p) => {
              const status = await installer.checkInstallation(p.path)
              return {
                path: p.path,
                name: p.name,
                editorVersion: p.editorVersion,
                movesiaInstalled: status.installed,
                movesiaVersion: status.version,
              }
            })
          )
          postMessage({ type: 'unityProjects', projects: projectsWithStatus })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error'
          postMessage({ type: 'unityProjectsError', error: errorMessage })
        }
        break
      }

      case 'checkPackageStatus': {
        try {
          const status = await installer.checkInstallation(message.projectPath)
          postMessage({
            type: 'packageStatus',
            projectPath: message.projectPath,
            installed: status.installed,
            version: status.version,
          })
        } catch (err) {
          postMessage({
            type: 'packageStatus',
            projectPath: message.projectPath,
            installed: false,
          })
        }
        break
      }

      case 'installPackage': {
        postMessage({ type: 'packageInstalling', projectPath: message.projectPath })
        try {
          const result = await installer.install(message.projectPath)
          postMessage({
            type: 'packageInstallComplete',
            projectPath: message.projectPath,
            success: result.success,
            error: result.error,
            version: result.installedVersion,
          })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error'
          postMessage({
            type: 'packageInstallComplete',
            projectPath: message.projectPath,
            success: false,
            error: errorMessage,
          })
        }
        break
      }

      case 'setSelectedProject': {
        await context.workspaceState.update(SELECTED_PROJECT_KEY, message.projectPath)
        postMessage({ type: 'selectedProject', projectPath: message.projectPath })
        break
      }

      case 'getSelectedProject': {
        const projectPath = context.workspaceState.get<string>(SELECTED_PROJECT_KEY) || null
        postMessage({ type: 'selectedProject', projectPath })
        break
      }

      case 'browseForProject': {
        const folder = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          title: 'Select Unity Project Folder',
          openLabel: 'Select Project',
        })

        if (!folder || folder.length === 0) {
          postMessage({ type: 'browseResult', project: null })
          return
        }

        const folderPath = folder[0].fsPath
        const project = await isUnityProject(folderPath)

        if (!project) {
          vscode.window.showErrorMessage('Selected folder is not a valid Unity project')
          postMessage({ type: 'browseResult', project: null })
          return
        }

        // Check installation status
        const status = await installer.checkInstallation(project.path)
        const projectInfo: UnityProjectInfo = {
          path: project.path,
          name: project.name,
          editorVersion: project.editorVersion,
          movesiaInstalled: status.installed,
          movesiaVersion: status.version,
        }
        postMessage({ type: 'browseResult', project: projectInfo })
        break
      }

      case 'checkUnityRunning': {
        // Check if Unity has the project open by looking for the Temp folder
        // Unity creates this folder when a project is open and removes it when closed
        const tempFolderPath = path.join(message.projectPath, 'Temp')
        const isRunning = fs.existsSync(tempFolderPath)
        postMessage({
          type: 'unityRunningStatus',
          projectPath: message.projectPath,
          isRunning,
        })
        break
      }
    }
  }

  context.subscriptions.push(
    // Existing webview commands - now starts at project selector
    vscode.commands.registerCommand('NextWebview1.start', async () => {
      await NextWebviewPanel.getInstance({
        extensionUri: context.extensionUri,
        route: 'projectSelector',
        title: 'Movesia AI Chat',
        viewId: 'movesiaChat',
        handleMessage: handleWebviewMessage,
      })
    }),
    vscode.commands.registerCommand('NextWebview2.start', async () => {
      await NextWebviewPanel.getInstance({
        extensionUri: context.extensionUri,
        route: 'view2',
        title: 'GitHub Next Webview 2',
        viewId: 'ghnextB',
      })
    }),

    // Unity package installation commands
    vscode.commands.registerCommand(
      'movesia.installUnityPackage',
      async (projectPath?: string): Promise<InstallResult> => {
        // If no path provided, prompt user to select a project
        if (!projectPath) {
          const selectedPath = await selectUnityProject()
          if (!selectedPath) {
            return { success: false, error: 'No project selected' }
          }
          projectPath = selectedPath
        }

        return vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Installing Movesia Unity Package',
            cancellable: false,
          },
          async progress => {
            progress.report({ message: 'Copying package files...' })

            const result = await installer.install(projectPath!)

            if (result.success) {
              if (result.alreadyInstalled) {
                vscode.window.showInformationMessage(
                  `Movesia package already installed (v${result.installedVersion})`
                )
              } else if (result.upgraded) {
                vscode.window.showInformationMessage(
                  `Movesia package upgraded: v${result.previousVersion} → v${result.installedVersion}`
                )
              } else {
                vscode.window.showInformationMessage(
                  `Movesia Unity package installed (v${result.installedVersion})! Unity will reload automatically.`
                )
              }
            } else {
              vscode.window.showErrorMessage(
                `Installation failed: ${result.error}`
              )
            }

            return result
          }
        )
      }
    ),

    vscode.commands.registerCommand(
      'movesia.checkUnityPackage',
      async (projectPath: string): Promise<InstalledPackageInfo> => {
        return installer.checkInstallation(projectPath)
      }
    ),

    vscode.commands.registerCommand(
      'movesia.uninstallUnityPackage',
      async (projectPath?: string): Promise<{ success: boolean; error?: string }> => {
        if (!projectPath) {
          const selectedPath = await selectUnityProject()
          if (!selectedPath) {
            return { success: false, error: 'No project selected' }
          }
          projectPath = selectedPath
        }

        const confirm = await vscode.window.showWarningMessage(
          'Are you sure you want to uninstall the Movesia Unity package?',
          { modal: true },
          'Uninstall'
        )

        if (confirm !== 'Uninstall') {
          return { success: false, error: 'Cancelled by user' }
        }

        const result = await installer.uninstall(projectPath)

        if (result.success) {
          vscode.window.showInformationMessage(
            'Movesia Unity package uninstalled successfully'
          )
        } else {
          vscode.window.showErrorMessage(
            `Uninstall failed: ${result.error}`
          )
        }

        return result
      }
    ),

    vscode.commands.registerCommand(
      'movesia.findUnityProjects',
      async (): Promise<UnityProject[]> => {
        return findUnityProjects()
      }
    ),

    vscode.commands.registerCommand(
      'movesia.selectUnityProject',
      async (): Promise<string | undefined> => {
        return selectUnityProject()
      }
    )
  )
}

/**
 * Show a quick pick dialog for selecting a Unity project
 */
async function selectUnityProject(): Promise<string | undefined> {
  // First, try to find projects from Unity Hub
  const projects = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Finding Unity projects...',
    },
    async () => {
      return findUnityProjects()
    }
  )

  interface ProjectQuickPickItem extends vscode.QuickPickItem {
    projectPath?: string
  }

  const items: ProjectQuickPickItem[] = projects.map(p => ({
    label: p.name,
    description: p.editorVersion ? `Unity ${p.editorVersion}` : undefined,
    detail: p.path,
    projectPath: p.path,
  }))

  // Add option to browse for folder
  items.push({
    label: '$(folder) Browse...',
    description: 'Select a Unity project folder',
    alwaysShow: true,
  })

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Select Unity Project',
    placeHolder: 'Choose a Unity project or browse for one',
  })

  if (!selected) {
    return undefined
  }

  // If browse was selected, open folder picker
  if (!selected.projectPath) {
    const folder = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: 'Select Unity Project Folder',
      openLabel: 'Select Project',
    })

    if (!folder || folder.length === 0) {
      return undefined
    }

    const folderPath = folder[0].fsPath

    // Validate it's a Unity project
    const project = await isUnityProject(folderPath)
    if (!project) {
      vscode.window.showErrorMessage(
        'Selected folder is not a valid Unity project'
      )
      return undefined
    }

    return folderPath
  }

  return selected.projectPath
}
