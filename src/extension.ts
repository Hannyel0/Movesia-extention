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
import {
  AgentService,
  type ChatRequest,
  type AgentEvent,
} from './services/agent-service'
import { AuthService, type AuthState } from './services/auth-service'

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
  | { type: 'clearSelectedProject' }
  | { type: 'browseForProject' }
  | { type: 'checkUnityRunning'; projectPath: string }
  | { type: 'chat'; messages: Array<{ id: string; role: string; content: string }>; threadId?: string }
  | { type: 'getUnityStatus' }
  | { type: 'getThreads' }
  | { type: 'getThreadMessages'; threadId: string }
  | { type: 'deleteThread'; threadId: string }
  | { type: 'getConversationDetails'; threadId: string }
  | { type: 'signIn' }
  | { type: 'signOut' }
  | { type: 'getAuthState' }

// Global service instances
let agentService: AgentService | null = null
let authService: AuthService | null = null

// Output channel for Movesia logs
let outputChannel: vscode.OutputChannel | null = null

// Key for storing selected project in workspace state
const SELECTED_PROJECT_KEY = 'movesia.selectedProject'

/**
 * Log to both console and VS Code Output Channel
 */
function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const timestamp = new Date().toISOString().slice(11, 19)
  const formattedMessage = `[${timestamp}] ${message}`

  // Log to console (Debug Console when debugging)
  if (level === 'error') {
    console.error(`[Movesia] ${message}`)
  } else if (level === 'warn') {
    console.warn(`[Movesia] ${message}`)
  } else {
    console.log(`[Movesia] ${message}`)
  }

  // Log to Output Channel (visible in Output panel)
  if (outputChannel) {
    outputChannel.appendLine(formattedMessage)
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Create Output Channel for Movesia
  outputChannel = vscode.window.createOutputChannel('Movesia Agent')
  context.subscriptions.push(outputChannel)

  log('Extension activating')

  // ═══════════════════════════════════════════════════════════════════════════════
  // AUTH SERVICE — OAuth 2.1 PKCE client
  // ═══════════════════════════════════════════════════════════════════════════════

  authService = new AuthService(context, outputChannel ?? undefined)

  // Initialize auth (restores cached user from SecretStorage)
  authService.initialize().catch(err => {
    log(`Auth init error: ${err?.message}`, 'warn')
  })

  // Note: OAuth callbacks are now received via a temporary localhost HTTP server
  // started by AuthService.signIn() — no URI handler needed.

  // Forward auth state changes to any open webview
  context.subscriptions.push(
    authService.onAuthStateChanged((state: AuthState) => {
      log(`[Auth] State changed: authenticated=${state.isAuthenticated}, user=${state.user?.email || 'none'}`)
      NextWebviewPanel.postMessageToAll({
        type: 'authStateChanged',
        state,
      })
    })
  )

  const installer = createInstaller(context.extensionPath)

  // ═══════════════════════════════════════════════════════════════════════════════
  // AGENT INITIALIZATION - Start immediately on extension activation
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the agent service.
   * Called immediately when extension activates - does not require a project path.
   */
  async function initializeAgentService(): Promise<void> {
    log('Initializing agent service...')

    if (agentService) {
      log('Agent service already exists')
      return
    }

    // Check if we have a previously selected project
    const savedProjectPath = context.workspaceState.get<string>(SELECTED_PROJECT_KEY)
    if (savedProjectPath) {
      log(`Found saved project: ${savedProjectPath}`)
    }

    agentService = new AgentService({
      context,
      projectPath: savedProjectPath, // Can be undefined - agent will start without it
      wsPort: 8765, // Unity WebSocket port
      outputChannel: outputChannel ?? undefined,
    })

    await agentService.initialize()
    log('✅ Agent service initialized successfully')

    // If we have a saved project, set it
    if (savedProjectPath && fs.existsSync(savedProjectPath)) {
      log(`Restoring project path: ${savedProjectPath}`)
      await agentService.setProjectPath(savedProjectPath)
    }
  }

  /**
   * Get the agent service, ensuring it's initialized.
   */
  function getAgentService(): AgentService {
    if (!agentService) {
      throw new Error('Agent service not initialized')
    }
    return agentService
  }

  /**
   * Set the project path on the agent service.
   * Called when user selects a project.
   */
  async function setAgentProjectPath(projectPath: string): Promise<void> {
    const service = getAgentService()
    await service.setProjectPath(projectPath)
    // Also save to workspace state for persistence
    await context.workspaceState.update(SELECTED_PROJECT_KEY, projectPath)
  }

  // Start agent initialization immediately (non-blocking)
  log('Starting agent initialization...')
  initializeAgentService()
    .then(() => {
      log('✅ Agent service initialization complete')
    })
    .catch(err => {
      log(`❌ Failed to initialize agent service: ${err?.message}`, 'error')
      console.error('[Extension] Error stack:', err?.stack)
    })

  /**
   * Handle messages from the webview
   */
  async function handleWebviewMessage(
    message: WebviewMessage,
    postMessage: (msg: any) => void
  ) {
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
        // Update both workspace state and agent service
        console.log('[Extension] Setting selected project:', message.projectPath)
        await context.workspaceState.update(SELECTED_PROJECT_KEY, message.projectPath)
        if (agentService) {
          console.log('[Extension] Updating agent service with new project path')
          await agentService.setProjectPath(message.projectPath)
        } else {
          console.warn('[Extension] Agent service not available - project path saved but not applied to agent')
        }
        postMessage({ type: 'selectedProject', projectPath: message.projectPath })
        console.log('[Extension] Project selection complete')
        break
      }

      case 'getSelectedProject': {
        const projectPath = context.workspaceState.get<string>(SELECTED_PROJECT_KEY) || null
        postMessage({ type: 'selectedProject', projectPath })
        break
      }

      case 'clearSelectedProject': {
        await context.workspaceState.update(SELECTED_PROJECT_KEY, undefined)
        if (agentService) {
          await agentService.clearProjectPath()
        }
        postMessage({ type: 'selectedProject', projectPath: null })
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

      case 'signIn': {
        if (!authService) {
          postMessage({ type: 'authStateChanged', state: { isAuthenticated: false, user: null, expiresAt: null } })
          return
        }
        try {
          const state = await authService.signIn()
          postMessage({ type: 'authStateChanged', state })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Sign-in failed'
          log(`Sign-in error: ${errorMessage}`, 'error')
          postMessage({ type: 'authError', error: errorMessage })
        }
        break
      }

      case 'signOut': {
        if (authService) {
          await authService.signOut()
        }
        postMessage({ type: 'authStateChanged', state: { isAuthenticated: false, user: null, expiresAt: null } })
        break
      }

      case 'getAuthState': {
        if (!authService) {
          postMessage({ type: 'authStateChanged', state: { isAuthenticated: false, user: null, expiresAt: null } })
          return
        }
        const authState = await authService.getAuthState()
        postMessage({ type: 'authStateChanged', state: authState })
        break
      }

      case 'chat': {
        // Handle chat messages - stream agent response back to webview

        // ── Auth gate: user must be signed in to use chat ──
        if (authService) {
          const authenticated = await authService.isAuthenticated()
          if (!authenticated) {
            postMessage({
              type: 'agentEvent',
              event: { type: 'error', errorText: 'Please sign in to use Movesia.' },
            })
            postMessage({ type: 'agentEvent', event: { type: 'done' } })
            return
          }
        }

        if (!agentService) {
          postMessage({
            type: 'agentEvent',
            event: { type: 'error', errorText: 'Agent not initialized. Please wait and try again.' },
          })
          postMessage({ type: 'agentEvent', event: { type: 'done' } })
          return
        }

        // Check if project is selected (optional - agent can work without it but Unity tools won't work)
        const projectPath = context.workspaceState.get<string>(SELECTED_PROJECT_KEY)
        if (!projectPath) {
          postMessage({
            type: 'agentEvent',
            event: { type: 'error', errorText: 'No project selected. Please select a Unity project first.' },
          })
          postMessage({ type: 'agentEvent', event: { type: 'done' } })
          return
        }

        try {
          const chatRequest: ChatRequest = {
            type: 'chat',
            messages: message.messages.map(m => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
            threadId: message.threadId,
          }

          const result = await agentService.handleChat(chatRequest, (event: AgentEvent) => {
            // Stream each event to the webview
            postMessage({ type: 'agentEvent', event })
          })

          // Send thread ID back for tracking
          postMessage({ type: 'chatThreadId', threadId: result.threadId })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error'
          console.error('[Extension] Chat error:', errorMessage)
          postMessage({
            type: 'agentEvent',
            event: { type: 'error', errorText: errorMessage },
          })
          postMessage({ type: 'agentEvent', event: { type: 'done' } })
        }
        break
      }

      case 'getUnityStatus': {
        // Return Unity connection status from agent service
        if (agentService) {
          const status = agentService.getUnityStatus()
          postMessage({
            type: 'unityStatus',
            status: {
              status: status.connected ? 'connected' : 'disconnected',
              project: status.projectPath || null,
              compiling: status.isCompiling,
              connections: status.connected ? 1 : 0,
            },
          })
        } else {
          console.log('[Extension] Unity status requested but agent service not available')
          postMessage({
            type: 'unityStatus',
            status: {
              status: 'disconnected',
              project: null,
              compiling: false,
              connections: 0,
            },
          })
        }
        break
      }

      case 'getThreads': {
        // List all conversation threads
        if (agentService) {
          try {
            const threads = await agentService.listThreads()
            postMessage({ type: 'threadsLoaded', threads })
          } catch (err) {
            console.error('[Extension] Error loading threads:', err)
            postMessage({ type: 'threadsLoaded', threads: [] })
          }
        } else {
          postMessage({ type: 'threadsLoaded', threads: [] })
        }
        break
      }

      case 'getThreadMessages': {
        // Get messages for a specific thread
        if (agentService) {
          try {
            const messages = await agentService.getThreadMessages(message.threadId)
            postMessage({
              type: 'threadMessagesLoaded',
              threadId: message.threadId,
              messages,
            })
          } catch (err) {
            console.error('[Extension] Error loading thread messages:', err)
            postMessage({
              type: 'threadMessagesLoaded',
              threadId: message.threadId,
              messages: [],
            })
          }
        } else {
          postMessage({
            type: 'threadMessagesLoaded',
            threadId: message.threadId,
            messages: [],
          })
        }
        break
      }

      case 'deleteThread': {
        // Delete a conversation thread
        if (agentService) {
          try {
            await agentService.deleteThread(message.threadId)
            postMessage({ type: 'threadDeleted', threadId: message.threadId })
          } catch (err) {
            console.error('[Extension] Error deleting thread:', err)
          }
        }
        break
      }

      case 'getConversationDetails': {
        // Get conversation details (title, etc.)
        if (agentService) {
          try {
            const conversation = await agentService.getConversation(message.threadId)
            postMessage({
              type: 'conversationDetails',
              threadId: message.threadId,
              title: conversation?.title || null,
            })
          } catch (err) {
            console.error('[Extension] Error getting conversation details:', err)
            postMessage({
              type: 'conversationDetails',
              threadId: message.threadId,
              title: null,
            })
          }
        } else {
          postMessage({
            type: 'conversationDetails',
            threadId: message.threadId,
            title: null,
          })
        }
        break
      }
    }
  }

  context.subscriptions.push(
    // Existing webview commands - now checks for last used project
    vscode.commands.registerCommand('NextWebview1.start', async () => {
      // Check if there's a previously selected project
      const savedProjectPath = context.workspaceState.get<string>(SELECTED_PROJECT_KEY)
      let initialRoute = 'signIn'

      if (savedProjectPath) {
        // Verify the project still exists
        const projectExists = fs.existsSync(savedProjectPath)
        if (projectExists) {
          // Check if the Movesia package is still installed
          const status = await installer.checkInstallation(savedProjectPath)
          if (status.installed) {
            // Check if Unity has the project open (Temp folder exists)
            const tempFolderPath = path.join(savedProjectPath, 'Temp')
            const isUnityOpen = fs.existsSync(tempFolderPath)

            if (isUnityOpen) {
              // All good - go straight to chat
              initialRoute = 'chatView'
            } else {
              // Unity not open - show install/setup screen
              initialRoute = 'installPackage'
            }
          } else {
            // Package not installed - show install screen
            initialRoute = 'installPackage'
          }
        } else {
          // Project no longer exists - clear the stored value
          await context.workspaceState.update(SELECTED_PROJECT_KEY, undefined)
        }
      }

      console.log(`[Extension] Starting with route: ${initialRoute}, savedProject: ${savedProjectPath}`)

      await NextWebviewPanel.getInstance({
        extensionUri: context.extensionUri,
        route: initialRoute,
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
    ),

    // Auth commands
    vscode.commands.registerCommand('movesia.signIn', async () => {
      if (!authService) {
        vscode.window.showErrorMessage('Auth service not initialized')
        return
      }
      try {
        await authService.signIn()
        vscode.window.showInformationMessage('Signed in to Movesia successfully!')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sign-in failed'
        vscode.window.showErrorMessage(`Sign-in failed: ${msg}`)
      }
    }),

    vscode.commands.registerCommand('movesia.signOut', async () => {
      if (authService) {
        await authService.signOut()
        vscode.window.showInformationMessage('Signed out of Movesia')
      }
    }),

    // Settings command — triggered from the native editor/title toolbar button
    vscode.commands.registerCommand('movesia.settings', () => {
      NextWebviewPanel.postMessageToAll({ type: 'settingsClicked' })
    })
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

/**
 * Extension deactivation - cleanup agent service
 */
export async function deactivate() {
  console.log('[Extension] Deactivating Movesia extension...')
  if (agentService) {
    await agentService.shutdown()
    agentService = null
  }
  if (authService) {
    authService.dispose()
    authService = null
  }
  console.log('[Extension] Movesia extension deactivated')
}
