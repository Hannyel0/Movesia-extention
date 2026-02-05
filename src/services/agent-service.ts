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
import { resolve } from 'path'
import { URL } from 'url'

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
// API Keys - Hardcoded for SaaS product
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * OpenRouter API key for LLM access.
 * This is a SaaS product - the key is provided by Movesia.
 */
const OPENROUTER_API_KEY =
  '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' // TODO: Replace with actual key

/**
 * Tavily API key for internet search (optional).
 */
const TAVILY_API_KEY = '' // TODO: Add if needed

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

function truncateOutput(output: unknown, maxLength: number = 50000): unknown {
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

    // Start WebSocket server for Unity connection
    await this.startWebSocketServer()

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
   */
  private async startWebSocketServer(): Promise<void> {
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

          // Parse session ID and connection sequence from URL
          const url = new URL(req.url ?? '/', `http://localhost:${port}`)
          const sessionId = url.searchParams.get('session') ?? undefined
          const connSeq = parseInt(url.searchParams.get('conn_seq') ?? '0', 10)

          // Hand off to Unity manager
          if (this.unityManager) {
            await this.unityManager.handleConnection(ws, sessionId, connSeq)
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
   * Handle a chat request from the webview.
   * Streams events back via the callback.
   */
  async handleChat(
    request: ChatRequest,
    onEvent: (event: AgentEvent) => void
  ): Promise<{ threadId: string }> {
    if (!this.agent) {
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
        logger.info(`[Chat] Conversation metadata created/updated for thread=${threadId.slice(0, 16)}`)
      }

      // Start the message
      onEvent(protocol.start())

      // Stream agent execution events
      const config = { configurable: { thread_id: threadId } }
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
          const toolInput = event.data?.input || {}
          const toolCallId = event.run_id || randomUUID()
          toolCallCount++

          logger.info(`[Tool #${toolCallCount}] START: ${toolName}`)

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
   * This can be called after initialization to configure the Unity project.
   */
  async setProjectPath(newPath: string): Promise<void> {
    const previousPath = this.config.projectPath
    logger.info(
      `Setting project path: ${newPath} (previous: ${previousPath || 'none'})`
    )

    this.config.projectPath = newPath
    process.env.UNITY_PROJECT_PATH = newPath

    // Also update the agent's project path
    const { setUnityProjectPath } = await import('../agent/agent')
    setUnityProjectPath(newPath)

    logger.info(`Project path updated successfully to: ${newPath}`)
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
        logger.warn(`No messages array found in checkpoint for thread: ${threadId}`)
        return []
      }

      logger.info(`Found ${messages.length} messages in checkpoint for thread: ${threadId}`)

      // DEBUG: Log the raw messages structure
      logger.info(`=== RAW MESSAGES DUMP ===`)
      messages.forEach((msg, idx) => {
        const msgObj = msg as any
        const debugInfo = {
          type: msgObj.type,
          hasContent: !!msgObj.content,
          contentType: typeof msgObj.content,
          contentPreview: typeof msgObj.content === 'string'
            ? msgObj.content.slice(0, 100)
            : Array.isArray(msgObj.content)
              ? `Array[${msgObj.content.length}]`
              : JSON.stringify(msgObj.content).slice(0, 100),
          hasToolCalls: !!msgObj.tool_calls,
          toolCallsCount: msgObj.tool_calls?.length || 0,
          allKeys: Object.keys(msgObj),
        }
        logger.info(`Message ${idx}: ${JSON.stringify(debugInfo, null, 2)}`)
      })
      logger.info(`=== END RAW MESSAGES DUMP ===`)

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
          logger.info(`Found ToolMessage: tool_call_id=${msgObj.tool_call_id}, name=${msgObj.name}`)
          // This is a ToolMessage containing the output for a tool call
          try {
            // Try to parse as JSON if it's a string
            const output = typeof msgObj.content === 'string'
              ? JSON.parse(msgObj.content)
              : msgObj.content
            toolOutputs.set(msgObj.tool_call_id, output)
            logger.info(`  Stored tool output for ${msgObj.tool_call_id}`)
          } catch {
            // If not JSON, store as-is
            toolOutputs.set(msgObj.tool_call_id, msgObj.content)
            logger.info(`  Stored raw tool output for ${msgObj.tool_call_id}`)
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

        logger.info(`Processing message type: ${msgObj.type}`)

        // Determine role based on message type
        let role = 'assistant'
        if (msgObj.type === 'human') {
          role = 'user'
          logger.info(`  -> Classified as USER message`)
        } else if (msgObj.type === 'ai' || msgObj.type === 'AIMessage') {
          role = 'assistant'
          logger.info(`  -> Classified as ASSISTANT message`)
        } else if (msgObj.type === 'system') {
          // Skip system messages (internal prompts)
          logger.info(`  -> SKIPPING system message`)
          continue
        } else if (msgObj.type === 'tool') {
          // Skip tool messages - they're merged into the assistant message tool_calls
          logger.info(`  -> SKIPPING tool message`)
          continue
        } else {
          logger.warn(`  -> UNKNOWN message type: ${msgObj.type}, defaulting to assistant`)
        }

        // Extract content
        let content = ''
        if (typeof msgObj.content === 'string') {
          content = msgObj.content
          logger.info(`  -> Content (string): "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`)
        } else if (Array.isArray(msgObj.content)) {
          // Handle structured content (e.g., Claude's content blocks)
          logger.info(`  -> Content is array with ${msgObj.content.length} blocks`)
          for (const block of msgObj.content) {
            if (block.type === 'text' && block.text) {
              content += block.text
              logger.info(`    -> Extracted text block: "${block.text.slice(0, 50)}..."`)
            }
          }
        } else {
          logger.warn(`  -> Content is neither string nor array: ${typeof msgObj.content}`)
        }

        // Extract tool calls if present (for assistant messages)
        let toolCalls: Array<{
          id: string
          name: string
          input?: Record<string, unknown>
          output?: unknown
        }> | undefined

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
          ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        }
        const msgDebugInfo = {
          role,
          contentLength: content.length,
          hasToolCalls: toolCalls && toolCalls.length > 0,
          toolCallsCount: toolCalls?.length || 0
        }
        logger.info(`  -> ADDING formatted message: ${JSON.stringify(msgDebugInfo)}`)
        formattedMessages.push(formattedMsg)
      }

      logger.info(`=== FORMATTED MESSAGES ===`)
      logger.info(`Total formatted: ${formattedMessages.length} messages`)
      logger.info(`Full messages array: ${JSON.stringify(formattedMessages.map(m => ({
        role: m.role,
        contentLength: m.content.length,
        contentPreview: m.content.slice(0, 50),
        hasToolCalls: !!m.tool_calls
      })), null, 2)}`)
      logger.info(`=== END FORMATTED MESSAGES ===`)

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
