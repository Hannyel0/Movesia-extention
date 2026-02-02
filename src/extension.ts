import * as vscode from 'vscode'
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

export function activate(context: vscode.ExtensionContext) {
  const installer = createInstaller(context.extensionPath)

  context.subscriptions.push(
    // Existing webview commands
    vscode.commands.registerCommand('NextWebview1.start', async () => {
      await NextWebviewPanel.getInstance({
        extensionUri: context.extensionUri,
        route: 'chatView',
        title: 'Movesia AI Chat',
        viewId: 'movesiaChat',
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
