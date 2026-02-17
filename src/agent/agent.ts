/**
 * Movesia Agent Factory
 *
 * Creates the LangGraph-based agent with Unity tools and middleware.
 * Uses langchain's createAgent (with middleware support) + deepagents
 * for filesystem access rooted at the Unity project path.
 *
 * This module is designed to run inside the VS Code extension process.
 * Configuration is passed dynamically rather than read from environment variables.
 */

import { resolve } from 'path'
import { ChatOpenAI } from '@langchain/openai'
import { TavilySearch } from '@langchain/tavily'
import { MemorySaver } from '@langchain/langgraph'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { unityTools, setUnityManager } from './unity-tools/index'
import { UNITY_AGENT_PROMPT } from './prompts'
import type { UnityManager } from './UnityConnection/index'

// Use require for CJS compatibility (moduleResolution: node)
const { createAgent, todoListMiddleware } = require('langchain')
const {
  createFilesystemMiddleware,
  CompositeBackend,
  StateBackend,
  StoreBackend,
  FilesystemBackend,
} = require('deepagents')

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Unity project path - set dynamically from extension.
 * Defaults to environment variable for backwards compatibility.
 */
let _unityProjectPath: string | null = process.env.UNITY_PROJECT_PATH ?? null

/**
 * Get the current Unity project path, or null if not set.
 */
export function getUnityProjectPath(): string | null {
  if (!_unityProjectPath) {
    return null
  }
  return resolve(_unityProjectPath)
}

/**
 * Check if a Unity project path has been configured.
 */
export function hasUnityProjectPath(): boolean {
  return _unityProjectPath !== null
}

/**
 * Set the Unity project path dynamically.
 * Call this from the extension when a project is selected.
 */
export function setUnityProjectPath(path: string): void {
  const previous = _unityProjectPath
  _unityProjectPath = path
  console.log(`[Agent] setUnityProjectPath: '${previous}' → '${path}'`)
}

/**
 * For backwards compatibility - resolves current path.
 * @deprecated Use getUnityProjectPath() instead
 */
export const UNITY_PROJECT_PATH_RESOLVED = _unityProjectPath
  ? resolve(_unityProjectPath)
  : ''

// ═══════════════════════════════════════════════════════════════════════════════
// LLM MODEL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create the ChatOpenAI model configured for OpenRouter.
 * API key is read from environment (set by extension before agent creation).
 */
export function createModel(apiKey?: string) {
  return new ChatOpenAI({
    modelName: 'anthropic/claude-haiku-4.5',
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
    },
    apiKey: apiKey ?? process.env.OPENROUTER_API_KEY,
  })
}

// Note: No default model instance - models should be created via createModel()
// with explicit API key from the AgentService.

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create internet search tool using Tavily.
 * API key is read from environment (set by extension before agent creation).
 */
function createInternetSearch(apiKey?: string) {
  const key = apiKey ?? process.env.TAVILY_API_KEY
  if (!key) {
    // Return null if no API key - agent will work without internet search
    return null
  }
  return new TavilySearch({
    tavilyApiKey: key,
    maxResults: 5,
  })
}

/**
 * Get all tools available to the agent.
 */
function getAllTools(tavilyApiKey?: string): any[] {
  const tools: any[] = [...unityTools]
  const internetSearch = createInternetSearch(tavilyApiKey)
  if (internetSearch) {
    tools.unshift(internetSearch)
  }
  return tools
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create the middleware stack for the agent.
 *
 * Middleware provides:
 * 1. todoListMiddleware - Task tracking for multi-step operations (langchain built-in,
 *    properly branded for the AgentMiddleware system). Provides `write_todos` tool.
 * 2. FilesystemMiddleware - Read/write files in the Unity project directory
 *    Uses CompositeBackend(defaultBackend, routes):
 *    - default: FilesystemBackend (real disk access at Unity project root)
 *    - /scratch/: StateBackend (ephemeral scratch space, current thread only)
 *    - /memories/: StoreBackend (persistent memories across threads, if store available)
 */
function createMiddlewareStack(projectPath?: string): any[] {
  const middleware: any[] = []

  console.log(
    `[Agent] createMiddlewareStack called with projectPath: ${
      projectPath ?? 'undefined'
    }`
  )

  // 1. Todo list middleware for task tracking (langchain built-in)
  // Provides the `write_todos` tool with proper AgentMiddleware branding.
  middleware.push(todoListMiddleware())
  console.log('[Agent] ✅ todoListMiddleware added')

  // 2. Filesystem middleware - only if we have a project path
  if (projectPath) {
    const assetsPath = resolve(projectPath, 'Assets')
    console.log(`[Agent] FilesystemBackend rootDir: ${assetsPath}`)
    middleware.push(
      createFilesystemMiddleware({
        // CompositeBackend takes positional args: (defaultBackend, routes)
        // - defaultBackend: FilesystemBackend rooted at Assets/ to avoid
        //   crawling Library/, Temp/, Logs/, etc. which bloat context
        // - routes: path-prefix → backend mapping (matching Python agent's pattern)
        backend: (config: any) => {
          console.log(
            `[Agent] CompositeBackend factory called, config.store: ${!!config.store}`
          )
          const backend = new CompositeBackend(
            new FilesystemBackend({ rootDir: assetsPath, virtualMode: true }),
            {
              '/scratch/': new StateBackend(config),
              ...(config.store
                ? { '/memories/': new StoreBackend(config) }
                : {}),
            }
          )
          console.log(
            `[Agent] ✅ CompositeBackend created (rootDir: ${assetsPath})`
          )
          return backend
        },
      })
    )
    console.log('[Agent] ✅ FilesystemMiddleware added')
  } else {
    console.warn(
      '[Agent] ⚠️  No projectPath — FilesystemMiddleware SKIPPED (no file access)'
    )
  }

  console.log(
    `[Agent] Middleware stack: ${
      middleware.length
    } middleware(s) — [${middleware
      .map((m: any) => m.name || 'anonymous')
      .join(', ')}]`
  )
  return middleware
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for creating the Movesia agent
 */
export interface CreateAgentOptions {
  /**
   * LangGraph checkpointer for conversation persistence.
   * Defaults to MemorySaver (in-memory, non-persistent).
   */
  checkpointer?: BaseCheckpointSaver

  /**
   * UnityManager instance for WebSocket communication.
   * If provided, will be registered with the unity tools.
   */
  unityManager?: UnityManager

  /**
   * OpenRouter API key for LLM access.
   * If not provided, reads from OPENROUTER_API_KEY env var.
   */
  openRouterApiKey?: string

  /**
   * Tavily API key for internet search.
   * If not provided, reads from TAVILY_API_KEY env var.
   * If no key available, internet search tool is disabled.
   */
  tavilyApiKey?: string

  /**
   * Unity project path.
   * If provided, sets the global project path for tools and
   * enables the filesystem middleware rooted at this directory.
   */
  projectPath?: string
}

/**
 * Create the Movesia agent with the given options.
 *
 * Uses langchain's `createAgent` (NOT the deprecated `createReactAgent` from
 * @langchain/langgraph/prebuilt) which supports middleware as a first-class
 * parameter.
 *
 * Middleware stack (matching the original Python agent):
 * - todoListMiddleware: Task tracking via `write_todos` tool (langchain built-in)
 * - FilesystemMiddleware: Read/write/edit files in the Unity project directory
 *   with CompositeBackend routing (state + store + filesystem)
 *
 * @param options - Agent configuration options
 * @returns Compiled LangGraph agent
 *
 * @example
 * ```typescript
 * import { createMovesiaAgent, setUnityProjectPath } from './agent';
 *
 * const agent = createMovesiaAgent({
 *     openRouterApiKey: 'sk-or-...',
 *     projectPath: 'C:/MyUnityProject'
 * });
 *
 * const result = await agent.invoke(
 *     { messages: [{ role: 'user', content: 'Show me the scene hierarchy' }] },
 *     { configurable: { thread_id: 'session-1' } }
 * );
 * ```
 */
export function createMovesiaAgent(options: CreateAgentOptions = {}) {
  const {
    checkpointer = new MemorySaver(),
    unityManager,
    openRouterApiKey,
    tavilyApiKey,
    projectPath,
  } = options

  console.log('[Agent] ═══════════════════════════════════════════════')
  console.log('[Agent] createMovesiaAgent called')
  console.log(`[Agent]   projectPath: ${projectPath ?? 'undefined'}`)
  console.log(
    `[Agent]   openRouterApiKey: ${
      openRouterApiKey ? openRouterApiKey.slice(0, 12) + '...' : 'undefined'
    }`
  )
  console.log(`[Agent]   tavilyApiKey: ${tavilyApiKey ? 'set' : 'undefined'}`)
  console.log(
    `[Agent]   checkpointer: ${
      checkpointer ? checkpointer.constructor.name : 'undefined'
    }`
  )
  console.log(
    `[Agent]   unityManager: ${unityManager ? 'provided' : 'undefined'}`
  )

  // Set project path if provided
  if (projectPath) {
    setUnityProjectPath(projectPath)
    console.log(`[Agent] ✅ setUnityProjectPath('${projectPath}')`)
  } else {
    console.warn(
      '[Agent] ⚠️  No projectPath provided — global path NOT updated'
    )
  }

  // Register unity manager if provided
  if (unityManager) {
    setUnityManager(unityManager)
    console.log('[Agent] ✅ setUnityManager registered')
  }

  // Create model with provided or env API key
  const llm = createModel(openRouterApiKey)
  console.log(`[Agent] ✅ LLM created: ${(llm as any).modelName ?? 'unknown'}`)

  // Get tools with optional internet search
  const tools = getAllTools(tavilyApiKey)
  console.log(
    `[Agent] ✅ Tools: ${tools.length} — [${tools
      .map((t: any) => t.name)
      .join(', ')}]`
  )

  // Build middleware stack (todo tracking + filesystem access)
  const middleware = createMiddlewareStack(projectPath)

  // Create the agent with langchain's createAgent (supports middleware)
  console.log('[Agent] Creating agent with createAgent()...')
  const agent = createAgent({
    model: llm,
    tools,
    systemPrompt: UNITY_AGENT_PROMPT,
    middleware,
    checkpointer,
  })
  console.log('[Agent] ✅ Agent created successfully')
  console.log('[Agent] ═══════════════════════════════════════════════')

  return agent
}

/**
 * Agent type returned by createMovesiaAgent
 */
export type MovesiaAgent = ReturnType<typeof createMovesiaAgent>

// Note: No default agent instance - agents should be created via createMovesiaAgent()
// with explicit configuration from the AgentService.
