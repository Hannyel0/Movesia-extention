import { useState, useCallback, useEffect, useRef } from 'react'
import type { ToolCallData, ToolCallState } from '../components/tools'
import type { ToolCallEvent, StreamingToolCalls } from '../types/chat'

// Debug logging helper
const DEBUG = true
function log(category: string, message: string, data?: unknown) {
  if (DEBUG) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12)
    if (data !== undefined) {
      console.log(`[${timestamp}] [${category}] ${message}`, data)
    } else {
      console.log(`[${timestamp}] [${category}] ${message}`)
    }
  }
}

interface UseToolCallsOptions {
  /** Current chat status from AI SDK */
  status: string
  /** Current messages array for counting assistant messages */
  messages: Array<{ role: string }>
}

interface UseToolCallsReturn {
  /** Tool calls currently being streamed */
  currentStreamTools: StreamingToolCalls | null
  /** Completed tool calls indexed by assistant message index */
  completedToolCalls: Map<number, ToolCallData[]>
  /** Callback to handle tool call events from SSE stream */
  handleToolCallEvent: (event: ToolCallEvent, messageId: string) => void
  /** Clear all tool call state */
  clearToolCalls: () => void
  /** Load tool calls from persistence (when loading old threads) */
  loadToolCalls: (toolCallsMap: Map<number, ToolCallData[]>) => void
  /** Get tool calls for a specific assistant message */
  getToolCallsForMessage: (
    messageIndex: number,
    isLastAssistant: boolean
  ) => ToolCallData[]
}

/**
 * Hook to manage tool call state independently from AI SDK.
 *
 * This hook tracks tool calls as they stream in from the backend,
 * manages their state transitions, and preserves them after streaming completes.
 *
 * Tool call lifecycle:
 * 1. tool-start → state: 'streaming'
 * 2. tool-input → state: 'executing' (input available)
 * 3. tool-output → state: 'completed' (output available)
 * 4. tool-error → state: 'error'
 */
export function useToolCalls({
  status,
  messages,
}: UseToolCallsOptions): UseToolCallsReturn {
  // Track tool calls for current streaming response
  const [currentStreamTools, setCurrentStreamTools] =
    useState<StreamingToolCalls | null>(null)

  // Track completed tool calls by assistant message index
  const [completedToolCalls, setCompletedToolCalls] = useState<
    Map<number, ToolCallData[]>
  >(new Map())

  // Track previous status to detect transitions
  const prevStatusRef = useRef(status)

  // Handle tool call events from SSE stream
  const handleToolCallEvent = useCallback(
    (event: ToolCallEvent, messageId: string) => {
      log('ToolEvent', `Received: ${event.type} for message ${messageId}`, event)

      setCurrentStreamTools(prev => {
        // Initialize if needed or if message ID changed
        const isNewMessage = !prev || prev.backendMessageId !== messageId
        const tools = isNewMessage ? new Map() : new Map(prev.tools)

        const existingTool = tools.get(event.toolCallId)

        switch (event.type) {
          case 'tool-start':
            tools.set(event.toolCallId, {
              id: event.toolCallId,
              name: event.toolName || 'unknown',
              state: 'streaming' as ToolCallState,
            })
            break

          case 'tool-input':
            tools.set(event.toolCallId, {
              id: event.toolCallId,
              name: event.toolName || existingTool?.name || 'unknown',
              state: 'executing' as ToolCallState,
              input: event.input,
            })
            break

          case 'tool-output':
            if (existingTool) {
              tools.set(event.toolCallId, {
                ...existingTool,
                state: 'completed' as ToolCallState,
                output: event.output,
              })
            } else {
              // Tool output without prior start/input (shouldn't happen but handle gracefully)
              tools.set(event.toolCallId, {
                id: event.toolCallId,
                name: 'unknown',
                state: 'completed' as ToolCallState,
                output: event.output,
              })
            }
            break

          case 'tool-error':
            if (existingTool) {
              tools.set(event.toolCallId, {
                ...existingTool,
                state: 'error' as ToolCallState,
                error: event.error,
              })
            }
            break
        }

        return { backendMessageId: messageId, tools }
      })
    },
    []
  )

  // Save tool calls when streaming ends
  useEffect(() => {
    log('Status', `Status changed to: ${status}`)

    // When transitioning from streaming to ready, save tool calls
    if (prevStatusRef.current === 'streaming' && status === 'ready') {
      if (currentStreamTools && currentStreamTools.tools.size > 0) {
        // Count assistant messages to get the index
        const assistantCount = messages.filter(m => m.role === 'assistant').length
        if (assistantCount > 0) {
          const assistantIndex = assistantCount - 1
          const toolsArray = Array.from(currentStreamTools.tools.values())
          log(
            'Status',
            `Saving ${toolsArray.length} tool calls for assistant ${assistantIndex}`
          )

          setCompletedToolCalls(prev => {
            const newMap = new Map(prev)
            newMap.set(assistantIndex, toolsArray)
            return newMap
          })
        }
        // Clear current stream tools
        setCurrentStreamTools(null)
      }
    }

    prevStatusRef.current = status
  }, [status, currentStreamTools, messages])

  // Clear all tool call state
  const clearToolCalls = useCallback(() => {
    setCurrentStreamTools(null)
    setCompletedToolCalls(new Map())
  }, [])

  // Load tool calls from persistence (when loading old threads)
  const loadToolCalls = useCallback((toolCallsMap: Map<number, ToolCallData[]>) => {
    log('ToolCalls', `Loading ${toolCallsMap.size} tool call entries from persistence`)
    setCompletedToolCalls(toolCallsMap)
  }, [])

  // Get tool calls for a specific assistant message
  const getToolCallsForMessage = useCallback(
    (assistantIndex: number, isLastAssistant: boolean): ToolCallData[] => {
      if (isLastAssistant && currentStreamTools && currentStreamTools.tools.size > 0) {
        // This is the streaming message - use current stream tools
        const toolsArray = Array.from(currentStreamTools.tools.values())
        log('DisplayMsg', `Using stream tools for assistant ${assistantIndex}`, {
          count: toolsArray.length,
        })
        return toolsArray
      }

      // Check completed tool calls
      const completed = completedToolCalls.get(assistantIndex)
      return completed || []
    },
    [currentStreamTools, completedToolCalls]
  )

  return {
    currentStreamTools,
    completedToolCalls,
    handleToolCallEvent,
    clearToolCalls,
    loadToolCalls,
    getToolCallsForMessage,
  }
}
