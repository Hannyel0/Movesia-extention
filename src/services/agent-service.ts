/**
 * Agent Service - Bridges VS Code Extension with LangGraph Agent
 *
 * This service:
 * - Manages the agent lifecycle within the extension
 * - Handles message streaming from webview to agent
 * - Manages the Unity WebSocket connection
 * - Provides the Vercel AI SDK protocol over postMessage
 */

import * as vscode from 'vscode'
import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import { resolve, join } from 'path'
import { URL } from 'url'
import * as dotenv from 'dotenv'

// Load .env from extension root (where package.json lives)
const _dotenvPath = join(__dirname, '..', '..', '.env')
const _dotenvResult = dotenv.config({ path: _dotenvPath })
console.log(
  `[Movesia] dotenv loaded from: ${_dotenvPath} — ${_dotenvResult.error ? `ERROR: ${_dotenvResult.error.message}` : `OK (${Object.keys(_dotenvResult.parsed ?? {}).length} vars)`}`
)

// Agent imports - these will be compiled alongside the extension
import { createMovesiaAgent, type MovesiaAgent } from '../agent/agent'
import { UnityManager, createUnityManager } from '../agent/UnityConnection'
import { setUnityManager } from '../agent/unity-tools/connection'
import { createLogger } from '../agent/UnityConnection/config'
import {
  getRepository,
  type ConversationRepository,
} from '../agent/database/repository'
import {
  setStoragePath,
  initDatabase,
  closeDatabase,
  getCheckpointSaver,
} from '../agent/database/engine'

const logger = createLogger('movesia.agent')

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// API Keys - Loaded from .env file
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * All API keys are read from the .env file at the extension root.
 * See .env for the full list of supported environment variables.
 *
 * Required:
 *   OPENROUTER_API_KEY  - OpenRouter API key for LLM access
 *
 * Optional:
 *   TAVILY_API_KEY      - Tavily API key for internet search
 *   LANGSMITH_API_KEY   - LangSmith tracing API key
 *   LANGSMITH_ENDPOINT  - LangSmith endpoint (default: https://api.smith.langchain.com)
 *   LANGSMITH_PROJECT   - LangSmith project name
 */
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ''
const TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? ''
const LANGSMITH_API_KEY = process.env.LANGSMITH_API_KEY ?? ''
const LANGSMITH_ENDPOINT =
  process.env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com'
const LANGSMITH_PROJECT = process.env.LANGSMITH_PROJECT ?? ''

export interface AgentServiceConfig {
  context: vscode.ExtensionContext
  /** Unity project path - can be set later via setProjectPath() */
  projectPath?: string
  wsPort?: number
  /** Optional output channel for logging */
  outputChannel?: vscode.OutputChannel
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  type: 'chat'
  messages: ChatMessage[]
  threadId?: string
}

export type AgentEventType =
  | 'start'
  | 'text-start'
  | 'text-delta'
  | 'text-end'
  | 'tool-input-start'
  | 'tool-input-delta'
  | 'tool-input-available'
  | 'tool-output-available'
  | 'finish-step'
  | 'finish'
  | 'error'
  | 'done'

export interface AgentEvent {
  type: AgentEventType
  [key: string]: unknown
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI Message Stream Protocol
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Implements Vercel AI SDK UI Message Stream Protocol v1.
 * Generates events that the webview can consume.
 */
class UIMessageStreamProtocol {
  readonly messageId: string
  readonly textId: string
  private textStarted: boolean = false

  constructor() {
    this.messageId = `msg_${randomUUID().replace(/-/g, '')}`
    this.textId = `text_${randomUUID().replace(/-/g, '')}`
  }

  start(): AgentEvent {
    return { type: 'start', messageId: this.messageId }
  }

  textStart(): AgentEvent {
    this.textStarted = true
    return { type: 'text-start', id: this.textId }
  }

  textDelta(content: string): AgentEvent | null {
    if (!content) return null
    return { type: 'text-delta', id: this.textId, delta: content }
  }

  textEnd(): AgentEvent | null {
    if (!this.textStarted) return null
    this.textStarted = false
    return { type: 'text-end', id: this.textId }
  }

  toolInputStart(toolCallId: string, toolName: string): AgentEvent {
    return { type: 'tool-input-start', toolCallId, toolName }
  }

  toolInputDelta(toolCallId: string, delta: string): AgentEvent {
    return { type: 'tool-input-delta', toolCallId, inputTextDelta: delta }
  }

  toolInputAvailable(
    toolCallId: string,
    toolName: string,
    input: unknown
  ): AgentEvent {
    return { type: 'tool-input-available', toolCallId, toolName, input }
  }

  toolOutputAvailable(toolCallId: string, output: unknown): AgentEvent {
    return { type: 'tool-output-available', toolCallId, output }
  }

  finishStep(): AgentEvent {
    return { type: 'finish-step' }
  }

  finish(): AgentEvent {
    return { type: 'finish' }
  }

  error(message: string): AgentEvent {
    return { type: 'error', errorText: message }
  }

  done(): AgentEvent {
    return { type: 'done' }
  }

  get isTextStarted(): boolean {
    return this.textStarted
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

function safeSerialize(obj: unknown): unknown {
  const seen = new WeakSet()
  return JSON.parse(
    JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]'
        }
        seen.add(value)
      }
      return value
    })
  )
}

/**
 * Unwrap tool input from LangGraph streamEvents v2 format.
 *
 * LangGraph wraps the actual tool arguments inside `{ input: "<json-string>" }`.
 * For example, a tool called with `{ action: "hierarchy" }` arrives as:
 *   `{ input: '{"action":"hierarchy"}' }`
 *
 * This function extracts the inner value and parses it if it's a JSON string,
 * returning the actual tool arguments the UI components expect.
 */
function unwrapToolInput(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw

  const obj = raw as Record<string, unknown>

  // Check for the LangGraph wrapper pattern: single "input" key
  if ('input' in obj) {
    const inner = obj.input

    // Inner value is a JSON string — parse it
    if (typeof inner === 'string') {
      try {
        return JSON.parse(inner)
      } catch {
        // Not valid JSON, return as-is
        return inner
      }
    }

    // Inner value is already an object — return it directly
    if (typeof inner === 'object' && inner !== null) {
      return inner
    }

    return inner
  }

  // No wrapper — return as-is (already the actual tool args)
  return raw
}

function truncateOutput(output: unknown, maxLength: number = 50000): unknown {
  // Extract .content from LangChain ToolMessage objects
  // ToolMessage wraps the actual output in { content: '...', type: 'tool', tool_call_id: '...', ... }
  if (typeof output === 'object' && output !== null && 'content' in output) {
    output = (output as { content: unknown }).content
  }

  if (typeof output === 'string') {
    if (output.length > maxLength) {
      return output.slice(0, maxLength) + '... [truncated]'
    }
    return output
  }
  const str = JSON.stringify(output)
  if (str.length > maxLength) {
    return str.slice(0, maxLength) + '... [truncated]'
  }
  return output
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Service Class
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentService {
  private agent: MovesiaAgent | null = null
  private unityManager: UnityManager | null = null
  private wsServer: WebSocketServer | null = null
  private repository: ConversationRepository | null = null
  private config: AgentServiceConfig
  private isInitialized = false
  private outputChannel: vscode.OutputChannel | null = null

  constructor(config: AgentServiceConfig) {
    this.config = config
    this.outputChannel = config.outputChannel ?? null
  }

  /**
   * Log to both console and VS Code Output Channel
   */
  private log(
    message: string,
    level: 'info' | 'warn' | 'error' = 'info'
  ): void {
    const timestamp = new Date().toISOString().slice(11, 19)
    const formattedMessage = `[${timestamp}] [Agent] ${message}`

    // Log to console
    if (level === 'error') {
      console.error(formattedMessage)
    } else if (level === 'warn') {
      console.warn(formattedMessage)
    } else {
      console.log(formattedMessage)
    }

    // Log to Output Channel
    if (this.outputChannel) {
      this.outputChannel.appendLine(formattedMessage)
    }
  }

  /**
   * Initialize the agent service.
   * Call this when the extension activates - does NOT require a project path.
   * The project path can be set later via setProjectPath().
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.log('Agent service already initialized')
      return
    }

    this.log('Initializing agent service...')
    if (this.config.projectPath) {
      this.log(`Initial project path: ${this.config.projectPath}`)
    } else {
      this.log('No project path set - agent will start without Unity project')
    }

    // Set up database storage path using VS Code's global storage
    const storagePath = this.config.context.globalStorageUri.fsPath
    setStoragePath(storagePath)
    this.log(`Database storage path: ${storagePath}`)

    // Initialize database
    await initDatabase()
    this.log('Database initialized (sql.js)')

    // Initialize database repository
    this.repository = getRepository()

    // Set environment variables for the agent (using hardcoded SaaS keys)
    process.env.OPENROUTER_API_KEY = OPENROUTER_API_KEY
    this.log(
      `OpenRouter API key: ${OPENROUTER_API_KEY ? 'configured' : 'MISSING!'}`
    )

    if (TAVILY_API_KEY) {
      process.env.TAVILY_API_KEY = TAVILY_API_KEY
      this.log('Tavily API key: configured')
    } else {
      this.log('Tavily API key: not configured (internet search disabled)')
    }

    // LangSmith tracing — set env vars before agent creation
    if (LANGSMITH_API_KEY) {
      process.env.LANGSMITH_TRACING = 'true'
      process.env.LANGSMITH_API_KEY = LANGSMITH_API_KEY
      process.env.LANGSMITH_ENDPOINT = LANGSMITH_ENDPOINT
      process.env.LANGSMITH_PROJECT = LANGSMITH_PROJECT
      this.log(`LangSmith tracing: enabled`)
      this.log(`  LANGSMITH_API_KEY: ${LANGSMITH_API_KEY.slice(0, 12)}...`)
      this.log(`  LANGSMITH_ENDPOINT: ${LANGSMITH_ENDPOINT}`)
      this.log(`  LANGSMITH_PROJECT: ${LANGSMITH_PROJECT}`)
      this.log(`  LANGSMITH_TRACING: ${process.env.LANGSMITH_TRACING}`)
    } else {
      this.log('LangSmith tracing: not configured (LANGSMITH_API_KEY is empty)')
    }

    // Only set project path env var if we have one
    if (this.config.projectPath) {
      process.env.UNITY_PROJECT_PATH = this.config.projectPath
    }

    // Create Unity manager
    this.unityManager = createUnityManager({
      onDomainEvent: async msg => {
        this.log(`Unity domain event: ${msg.type}`)
      },
    })

    // Register unity manager globally for tools
    setUnityManager(this.unityManager)

    // NOTE: WebSocket server is NOT started here.
    // It starts lazily when a project path is set via setProjectPath(),
    // so we only accept connections from the correct Unity project.

    // Create the agent with sql.js checkpointer
    this.log('Creating LangGraph agent...')
    const checkpointer = getCheckpointSaver()
    this.agent = createMovesiaAgent({
      checkpointer,
      unityManager: this.unityManager,
      openRouterApiKey: OPENROUTER_API_KEY,
      tavilyApiKey: TAVILY_API_KEY || undefined,
      projectPath: this.config.projectPath,
    })
    this.log('✅ LangGraph agent created with SqlJsCheckpointer')

    this.isInitialized = true
    this.log('=== Agent service initialization complete ===')
  }

  /**
   * Start the WebSocket server for Unity connections.
   * Called lazily when a project path is set — not during initialization.
   */
  private async startWebSocketServer(): Promise<void> {
    // Don't start if already running
    if (this.wsServer) {
      this.log('WebSocket server already running')
      return
    }

    const port = this.config.wsPort ?? 8765

    this.log(`Starting WebSocket server on port ${port}...`)

    return new Promise((resolve, reject) => {
      try {
        this.wsServer = new WebSocketServer({ port })

        this.wsServer.on('listening', () => {
          this.log(`✅ WebSocket server listening on port ${port}`)
          resolve()
        })

        this.wsServer.on('connection', async (ws: WebSocket, req) => {
          this.log(`🎮 Unity connection from ${req.socket.remoteAddress}`)

          // Parse session ID, connection sequence, and project path from URL
          const url = new URL(req.url ?? '/', `http://localhost:${port}`)
          const sessionId = url.searchParams.get('session') ?? undefined
          const connSeq = parseInt(
            url.searchParams.get('conn') ??
              url.searchParams.get('conn_seq') ??
              '0',
            10
          )
          const projectPath = url.searchParams.get('projectPath')
            ? decodeURIComponent(url.searchParams.get('projectPath')!)
            : undefined

          this.log(
            `🔗 Connection params: session=${
              sessionId?.slice(0, 8) ?? 'none'
            }..., connSeq=${connSeq}, projectPath=${projectPath ?? 'none'}`
          )

          // Hand off to Unity manager (which validates the project path)
          if (this.unityManager) {
            await this.unityManager.handleConnection(
              ws,
              sessionId,
              connSeq,
              projectPath
            )
          }
        })

        this.wsServer.on('error', err => {
          this.log(`❌ WebSocket server error: ${err.message}`, 'error')
          reject(err)
        })
      } catch (err) {
        this.log(
          `❌ Failed to create WebSocket server: ${(err as Error).message}`,
          'error'
        )
        reject(err)
      }
    })
  }

  /**
   * Stop the WebSocket server and disconnect all Unity connections.
   */
  private async stopWebSocketServer(): Promise<void> {
    if (!this.wsServer) {
      return
    }

    this.log('Stopping WebSocket server...')

    // Close all Unity connections first
    if (this.unityManager) {
      await this.unityManager.closeAll()
    }

    // Close the server
    return new Promise(resolve => {
      this.wsServer!.close(() => {
        this.log('WebSocket server stopped')
        this.wsServer = null
        resolve()
      })
    })
  }

  /**
   * Handle a chat request from the webview.
   * Streams events back via the callback.
   */
  async handleChat(
    request: ChatRequest,
    onEvent: (event: AgentEvent) => void
  ): Promise<{ threadId: string }> {
    this.log(`🔍 [DEBUG] handleChat() called. agent=${this.agent ? 'EXISTS' : '❌ NULL'}, projectPath="${this.config.projectPath || 'NOT SET'}", unityManager=${this.unityManager ? 'EXISTS' : 'NULL'}, isConnected=${this.unityManager?.isConnected}, wsServer=${this.wsServer ? 'running' : 'not running'}`)
    if (!this.agent) {
      this.log('🔍 [DEBUG] ❌ handleChat blocked: agent is NULL')
      onEvent({ type: 'error', errorText: 'Agent not initialized' })
      onEvent({ type: 'done' })
      throw new Error('Agent not initialized')
    }

    const protocol = new UIMessageStreamProtocol()

    // Get or generate thread ID
    let threadId = request.threadId
    if (!threadId || threadId === 'default') {
      threadId = `thread_${randomUUID().replace(/-/g, '')}`
    }

    // Get the last user message
    const lastMessage = request.messages[request.messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'user') {
      onEvent(protocol.error('No user message provided'))
      onEvent(protocol.done())
      throw new Error('No user message provided')
    }

    const userText = lastMessage.content

    // Track state
    let hasTextContent = false
    const currentToolCalls = new Map<string, string>()
    let toolCallCount = 0
    const startTime = Date.now()

    logger.info(`[Chat] Starting for thread=${threadId.slice(0, 16)}...`)

    try {
      // Ensure conversation metadata exists in the database
      if (this.repository) {
        await this.repository.getOrCreate(threadId, {
          unityProjectPath: this.config.projectPath || null,
          unityVersion: null,
        })
        logger.info(
          `[Chat] Conversation metadata created/updated for thread=${threadId.slice(
            0,
            16
          )}`
        )
      }

      // Start the message
      onEvent(protocol.start())

      // Stream agent execution events
      const config = { configurable: { thread_id: threadId }, recursionLimit: 100 }
      const inputData = {
        messages: [{ role: 'human' as const, content: userText }],
      }

      const eventStream = await this.agent.streamEvents(inputData, {
        ...config,
        version: 'v2',
      })

      for await (const event of eventStream) {
        const kind = event.event

        if (kind === 'on_chat_model_stream') {
          const chunk = event.data?.chunk
          if (chunk && chunk.content) {
            const content = chunk.content

            // Handle string content
            if (typeof content === 'string' && content) {
              if (!hasTextContent) {
                onEvent(protocol.textStart())
                hasTextContent = true
              }
              const delta = protocol.textDelta(content)
              if (delta) onEvent(delta)
            }
            // Handle array content (e.g., from Claude)
            else if (Array.isArray(content)) {
              for (const block of content) {
                let text = ''
                if (
                  typeof block === 'object' &&
                  block !== null &&
                  block.type === 'text'
                ) {
                  text = (block as { type: string; text?: string }).text || ''
                } else if (typeof block === 'string') {
                  text = block
                }

                if (text) {
                  if (!hasTextContent) {
                    onEvent(protocol.textStart())
                    hasTextContent = true
                  }
                  const delta = protocol.textDelta(text)
                  if (delta) onEvent(delta)
                }
              }
            }
          }
        } else if (kind === 'on_tool_start') {
          // End any ongoing text block before tool call
          if (hasTextContent) {
            const textEnd = protocol.textEnd()
            if (textEnd) onEvent(textEnd)
            hasTextContent = false
          }

          const toolName = event.name || 'unknown'
          const rawToolInput = event.data?.input || {}
          const toolCallId = event.run_id || randomUUID()
          toolCallCount++

          logger.info(`[Tool #${toolCallCount}] START: ${toolName}`)

          // LangGraph streamEvents v2 wraps tool args inside { input: "<json-string>" }.
          // Unwrap: extract the inner value and parse if it's a JSON string.
          const toolInput = unwrapToolInput(rawToolInput)

          // Track the tool call
          currentToolCalls.set(toolCallId, toolName)

          // Stream tool input
          onEvent(protocol.toolInputStart(toolCallId, toolName))
          const serializedInput = safeSerialize(toolInput)

          onEvent(
            protocol.toolInputDelta(toolCallId, JSON.stringify(serializedInput))
          )
          onEvent(
            protocol.toolInputAvailable(toolCallId, toolName, serializedInput)
          )
        } else if (kind === 'on_tool_end') {
          const toolCallId = event.run_id || ''
          const toolOutput = event.data?.output
          const toolName = currentToolCalls.get(toolCallId) || 'unknown'

          logger.info(`[Tool] END: ${toolName}`)

          // Send tool result
          const truncatedOutput = truncateOutput(toolOutput)
          onEvent(protocol.toolOutputAvailable(toolCallId, truncatedOutput))

          // Remove from tracking
          currentToolCalls.delete(toolCallId)

          // Signal step finished
          onEvent(protocol.finishStep())
        }
      }

      // End any remaining text block
      if (hasTextContent) {
        const textEnd = protocol.textEnd()
        if (textEnd) onEvent(textEnd)
      }

      // Calculate duration
      const duration = (Date.now() - startTime) / 1000
      logger.info(
        `[Chat] Complete: ${toolCallCount} tools in ${duration.toFixed(2)}s`
      )

      // Update conversation timestamp and title (if first message)
      if (this.repository) {
        await this.repository.touch(threadId)

        // Auto-generate title from first user message (truncated)
        const conversation = await this.repository.get(threadId)
        if (conversation && !conversation.title) {
          const title = userText.slice(0, 100).trim()
          await this.repository.updateTitle(threadId, title)
        }
      }

      // Finish the message
      onEvent(protocol.finish())
      onEvent(protocol.done())

      return { threadId }
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      logger.error(
        `[Chat] ERROR after ${duration.toFixed(2)}s: ${errorMessage}`
      )

      // End text block if needed
      if (hasTextContent) {
        const textEnd = protocol.textEnd()
        if (textEnd) onEvent(textEnd)
      }
      onEvent(protocol.error(errorMessage))
      onEvent(protocol.done())

      throw error
    }
  }

  /**
   * Get Unity connection status.
   */
  getUnityStatus(): {
    connected: boolean
    projectPath?: string
    isCompiling: boolean
  } {
    if (!this.unityManager) {
      return { connected: false, isCompiling: false }
    }

    return {
      connected: this.unityManager.isConnected,
      projectPath: this.unityManager.currentProject,
      isCompiling: this.unityManager.isCompiling,
    }
  }

  /**
   * Set or update the project path (when user selects/switches projects).
   * This triggers the WebSocket server to start (if not already running)
   * and configures project-scoped connection filtering.
   */
  async setProjectPath(newPath: string): Promise<void> {
    const previousPath = this.config.projectPath
    this.log(`🔍 [DEBUG] setProjectPath() called: "${newPath}" (previous: "${previousPath || 'none'}")`)

    this.config.projectPath = newPath
    process.env.UNITY_PROJECT_PATH = newPath
    this.log(`🔍 [DEBUG] config.projectPath and env updated`)

    // Also update the agent's project path
    const { setUnityProjectPath } = await import('../agent/agent')
    setUnityProjectPath(newPath)
    this.log(`🔍 [DEBUG] setUnityProjectPath() called on agent module`)

    // Set target project on UnityManager (routes commands to matching Unity instance)
    if (this.unityManager) {
      this.log(`🔍 [DEBUG] Calling unityManager.setTargetProject("${newPath}")...`)
      await this.unityManager.setTargetProject(newPath)
      this.log(`🔍 [DEBUG] unityManager.setTargetProject() complete. isConnected=${this.unityManager.isConnected}, targetProjectPath="${this.unityManager.targetProjectPath}", connectionCount=${this.unityManager.connectionCount}`)
    } else {
      this.log(`🔍 [DEBUG] ❌ unityManager is NULL! Cannot set target project.`, 'warn')
    }

    // Start WebSocket server if not already running
    // (first project selection triggers the server)
    if (!this.wsServer) {
      this.log('🔍 [DEBUG] WebSocket server not running yet — starting it now...')
      await this.startWebSocketServer()
      this.log(`🔍 [DEBUG] WebSocket server started. wsServer is ${this.wsServer ? 'SET' : 'still NULL'}`)
    } else {
      this.log(`🔍 [DEBUG] WebSocket server already running — skipping start`)
    }

    this.log(`🔍 [DEBUG] setProjectPath() complete. Final state: projectPath="${this.config.projectPath}", isConnected=${this.unityManager?.isConnected}, wsServer=${this.wsServer ? 'running' : 'not running'}`)
  }

  /**
   * Clear the project path and stop the WebSocket server.
   * Called when user clears their project selection.
   */
  async clearProjectPath(): Promise<void> {
    logger.info('Clearing project path')

    this.config.projectPath = undefined
    delete process.env.UNITY_PROJECT_PATH

    const { setUnityProjectPath } = await import('../agent/agent')
    setUnityProjectPath('')

    // Stop WebSocket server — no project means no reason to accept connections
    await this.stopWebSocketServer()

    logger.info('Project path cleared, WebSocket server stopped')
  }

  /**
   * Get the current project path.
   */
  getProjectPath(): string | undefined {
    return this.config.projectPath
  }

  /**
   * Check if a project path has been set.
   */
  hasProjectPath(): boolean {
    return !!this.config.projectPath
  }

  /**
   * List all conversation threads.
   */
  async listThreads(): Promise<
    Array<{
      session_id: string
      title: string | null
      created_at: string
    }>
  > {
    if (!this.repository) {
      return []
    }

    const conversations = await this.repository.listAll()
    return conversations.map(c => ({
      session_id: c.sessionId,
      title: c.title,
      created_at: c.createdAt.toISOString(),
    }))
  }

  /**
   * Get conversation details.
   */
  async getConversation(threadId: string): Promise<{
    session_id: string
    title: string | null
  } | null> {
    if (!this.repository) {
      return null
    }

    const conversation = await this.repository.get(threadId)
    if (!conversation) {
      return null
    }

    return {
      session_id: conversation.sessionId,
      title: conversation.title,
    }
  }

  /**
   * Get messages for a thread.
   * Note: This retrieves messages from LangGraph's checkpoint system.
   */
  async getThreadMessages(threadId: string): Promise<
    Array<{
      role: string
      content: string
      tool_calls?: Array<{
        id: string
        name: string
        input?: Record<string, unknown>
        output?: unknown
      }>
    }>
  > {
    logger.info(`Getting messages for thread: ${threadId}`)

    try {
      // Get the checkpointer instance
      const checkpointer = getCheckpointSaver()

      // Retrieve the latest checkpoint for this thread
      const config = { configurable: { thread_id: threadId } }
      const checkpointTuple = await checkpointer.getTuple(config)

      if (!checkpointTuple) {
        logger.info(`No checkpoint found for thread: ${threadId}`)
        return []
      }

      // Extract messages from the checkpoint
      const checkpoint = checkpointTuple.checkpoint
      const channelValues = checkpoint.channel_values as Record<string, unknown>

      // LangGraph stores messages in the 'messages' channel
      const messages = channelValues.messages

      if (!messages || !Array.isArray(messages)) {
        logger.warn(
          `No messages array found in checkpoint for thread: ${threadId}`
        )
        return []
      }

      logger.info(
        `Found ${messages.length} messages in checkpoint for thread: ${threadId}`
      )

      // First pass: Build a map of tool outputs by tool_call_id
      const toolOutputs = new Map<string, unknown>()
      for (const msg of messages) {
        const msgObj = msg as {
          type?: string
          content?: string
          tool_call_id?: string
          name?: string
        }

        if (msgObj.type === 'tool' && msgObj.tool_call_id) {
          try {
            const output =
              typeof msgObj.content === 'string'
                ? JSON.parse(msgObj.content)
                : msgObj.content
            toolOutputs.set(msgObj.tool_call_id, output)
          } catch {
            toolOutputs.set(msgObj.tool_call_id, msgObj.content)
          }
        }
      }

      // Second pass: Convert LangGraph messages to our format
      const formattedMessages: Array<{
        role: string
        content: string
        tool_calls?: Array<{
          id: string
          name: string
          input?: Record<string, unknown>
          output?: unknown
        }>
      }> = []

      for (const msg of messages) {
        // LangGraph messages can be BaseMessage objects with different types
        // Common types: HumanMessage, AIMessage, ToolMessage, SystemMessage
        const msgObj = msg as {
          type?: string
          content?: string | Array<{ type: string; text?: string }>
          tool_calls?: Array<{
            id?: string
            name?: string
            args?: Record<string, unknown>
          }>
          id?: string
          name?: string
        }

        // Determine role based on message type
        let role = 'assistant'
        if (msgObj.type === 'human') {
          role = 'user'
        } else if (msgObj.type === 'ai' || msgObj.type === 'AIMessage') {
          role = 'assistant'
        } else if (msgObj.type === 'system') {
          continue
        } else if (msgObj.type === 'tool') {
          continue
        } else {
          logger.warn(
            `Unknown message type: ${msgObj.type}, defaulting to assistant`
          )
        }

        // Extract content
        let content = ''
        if (typeof msgObj.content === 'string') {
          content = msgObj.content
        } else if (Array.isArray(msgObj.content)) {
          for (const block of msgObj.content) {
            if (block.type === 'text' && block.text) {
              content += block.text
            }
          }
        }

        // Extract tool calls if present (for assistant messages)
        let toolCalls:
          | Array<{
              id: string
              name: string
              input?: Record<string, unknown>
              output?: unknown
            }>
          | undefined

        if (msgObj.tool_calls && msgObj.tool_calls.length > 0) {
          toolCalls = msgObj.tool_calls.map(tc => {
            const toolCallId = tc.id || randomUUID()
            return {
              id: toolCallId,
              name: tc.name || 'unknown',
              input: tc.args,
              output: toolOutputs.get(toolCallId), // Attach the output from ToolMessage
            }
          })
        }

        // Add formatted message
        const formattedMsg = {
          role,
          content,
          ...(toolCalls && toolCalls.length > 0
            ? { tool_calls: toolCalls }
            : {}),
        }
        formattedMessages.push(formattedMsg)
      }

      return formattedMessages
    } catch (error) {
      logger.error(`Error getting messages for thread ${threadId}: ${error}`)
      return []
    }
  }

  /**
   * Delete a conversation thread.
   */
  async deleteThread(threadId: string): Promise<boolean> {
    if (!this.repository) {
      return false
    }

    return this.repository.delete(threadId)
  }

  /**
   * Shutdown the agent service.
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down agent service...')

    // Close Unity connections
    if (this.unityManager) {
      await this.unityManager.closeAll()
    }

    // Close WebSocket server
    if (this.wsServer) {
      this.wsServer.close()
    }

    // Close database connection
    await closeDatabase()

    this.agent = null
    this.unityManager = null
    this.wsServer = null
    this.repository = null
    this.isInitialized = false

    logger.info('Agent service shutdown complete')
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Factory Function
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create and initialize the agent service.
 */
export async function createAgentService(
  config: AgentServiceConfig
): Promise<AgentService> {
  const service = new AgentService(config)
  await service.initialize()
  return service
}
