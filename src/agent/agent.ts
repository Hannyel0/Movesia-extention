/**
 * Movesia Agent Factory
 *
 * Creates the LangGraph-based agent with Unity tools and middleware.
 *
 * This module is designed to run inside the VS Code extension process.
 * Configuration is passed dynamically rather than read from environment variables.
 */

import { resolve } from 'path';
import { ChatOpenAI } from '@langchain/openai';
// Use require for subpath imports due to moduleResolution: node limitations
const { createReactAgent } = require('@langchain/langgraph/prebuilt');
import { TavilySearch } from '@langchain/tavily';
import { MemorySaver } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { unityTools, setUnityManager } from './unity-tools/index';
import { UNITY_AGENT_PROMPT } from './prompts';
import type { UnityManager } from './UnityConnection/index';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Unity project path - set dynamically from extension.
 * Defaults to environment variable for backwards compatibility.
 */
let _unityProjectPath: string | null = process.env.UNITY_PROJECT_PATH ?? null;

/**
 * Get the current Unity project path, or null if not set.
 */
export function getUnityProjectPath(): string | null {
    if (!_unityProjectPath) {
        return null;
    }
    return resolve(_unityProjectPath);
}

/**
 * Check if a Unity project path has been configured.
 */
export function hasUnityProjectPath(): boolean {
    return _unityProjectPath !== null;
}

/**
 * Set the Unity project path dynamically.
 * Call this from the extension when a project is selected.
 */
export function setUnityProjectPath(path: string): void {
    _unityProjectPath = path;
}

/**
 * For backwards compatibility - resolves current path.
 * @deprecated Use getUnityProjectPath() instead
 */
export const UNITY_PROJECT_PATH_RESOLVED = _unityProjectPath ? resolve(_unityProjectPath) : '';

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
    });
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
    const key = apiKey ?? process.env.TAVILY_API_KEY;
    if (!key) {
        // Return null if no API key - agent will work without internet search
        return null;
    }
    return new TavilySearch({
        tavilyApiKey: key,
        maxResults: 5,
    });
}

/**
 * Get all tools available to the agent.
 */
function getAllTools(tavilyApiKey?: string): any[] {
    const tools: any[] = [...unityTools];
    const internetSearch = createInternetSearch(tavilyApiKey);
    if (internetSearch) {
        tools.unshift(internetSearch);
    }
    return tools;
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
    checkpointer?: BaseCheckpointSaver;

    /**
     * UnityManager instance for WebSocket communication.
     * If provided, will be registered with the unity tools.
     */
    unityManager?: UnityManager;

    /**
     * OpenRouter API key for LLM access.
     * If not provided, reads from OPENROUTER_API_KEY env var.
     */
    openRouterApiKey?: string;

    /**
     * Tavily API key for internet search.
     * If not provided, reads from TAVILY_API_KEY env var.
     * If no key available, internet search tool is disabled.
     */
    tavilyApiKey?: string;

    /**
     * Unity project path.
     * If provided, sets the global project path for tools.
     */
    projectPath?: string;
}

/**
 * Create the Movesia agent with the given options.
 *
 * @param options - Agent configuration options
 * @returns Compiled LangGraph agent
 *
 * @example
 * ```typescript
 * import { createMovesiaAgent, setUnityProjectPath } from './agent';
 *
 * // Set project path before creating agent
 * setUnityProjectPath('C:/MyUnityProject');
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
    } = options;

    // Set project path if provided
    if (projectPath) {
        setUnityProjectPath(projectPath);
    }

    // Register unity manager if provided
    if (unityManager) {
        setUnityManager(unityManager);
    }

    // Create model with provided or env API key
    const llm = createModel(openRouterApiKey);

    // Get tools with optional internet search
    const tools = getAllTools(tavilyApiKey);

    // Create the React agent with LangGraph
    const agent = createReactAgent({
        llm,
        tools,
        messageModifier: UNITY_AGENT_PROMPT,
        checkpointSaver: checkpointer,
    });

    return agent;
}

/**
 * Agent type returned by createMovesiaAgent
 */
export type MovesiaAgent = ReturnType<typeof createMovesiaAgent>;

// Note: No default agent instance - agents should be created via createMovesiaAgent()
// with explicit configuration from the AgentService.
