/**
 * Custom Chat State Hook - Replacement for AI SDK useChat
 *
 * This hook manages chat state directly via VS Code postMessage,
 * eliminating the need for AI SDK and its Zod v4 dependency.
 *
 * Features:
 * - Message state management
 * - Streaming text accumulation
 * - Tool call event handling
 * - Loading/error states
 * - Thread ID management
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import VSCodeAPI from '../VSCodeAPI'
import type { ToolCallData, ToolCallState } from '../components/tools'

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

// =============================================================================
// TYPES
// =============================================================================

/** Chat message format */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

/** Chat status */
export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

/** Agent event from extension */
interface AgentEvent {
  type: string
  [key: string]: unknown
}

/** Tool call event for useToolCalls compatibility */
export interface ToolCallEvent {
  type: 'tool-start' | 'tool-input' | 'tool-output' | 'tool-error'
  toolCallId: string
  toolName?: string
  input?: unknown
  output?: unknown
  error?: string
  textLengthAtEvent?: number
}

/** Options for useChatState hook */
export interface UseChatStateOptions {
  /** Callback when a tool call event is received */
  onToolCallEvent?: (event: ToolCallEvent, messageId: string) => void
}

/** Return type for useChatState hook */
export interface UseChatStateReturn {
  /** All messages in the conversation */
  messages: ChatMessage[]
  /** Set messages (for loading from threads) */
  setMessages: (messages: ChatMessage[]) => void
  /** Current status */
  status: ChatStatus
  /** Error if any */
  error: Error | null
  /** Send a new message */
  sendMessage: (content: string) => void
  /** Stop current generation (not fully implemented - would need backend support) */
  stop: () => void
  /** Current thread ID */
  threadId: string | null
  /** Set thread ID (for thread switching) */
  setThreadId: (id: string | null) => void
  /** Whether the chat is loading/streaming */
  isLoading: boolean
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

export function useChatState(options: UseChatStateOptions = {}): UseChatStateReturn {
  const { onToolCallEvent } = options

  // Core state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>('ready')
  const [error, setError] = useState<Error | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)

  // Streaming state - use refs for values that change during streaming
  const currentMessageIdRef = useRef<string>('')
  const accumulatedTextRef = useRef<string>('')
  const isStreamingRef = useRef<boolean>(false)

  // Handle incoming agent events from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data

      // Handle thread ID response
      if (data.type === 'chatThreadId') {
        log('Chat', `Thread ID received: ${data.threadId}`)
        setThreadId(data.threadId)
        return
      }

      // Handle agent events
      if (data.type !== 'agentEvent') {
        return
      }

      const agentEvent = data.event as AgentEvent
      log('Chat', `Agent event: ${agentEvent.type}`, agentEvent)

      switch (agentEvent.type) {
        case 'start':
          // New message starting
          currentMessageIdRef.current = (agentEvent.messageId as string) || `msg_${Date.now()}`
          accumulatedTextRef.current = ''
          isStreamingRef.current = true
          setStatus('streaming')
          setError(null)

          // Add placeholder assistant message
          setMessages(prev => [
            ...prev,
            {
              id: currentMessageIdRef.current,
              role: 'assistant',
              content: '',
            },
          ])
          break

        case 'text-start':
          // Text block starting - nothing special needed
          break

        case 'text-delta':
          // Accumulate text
          const delta = agentEvent.delta as string
          if (delta) {
            accumulatedTextRef.current += delta
            // Update the last message with accumulated text
            setMessages(prev => {
              const newMessages = [...prev]
              const lastIdx = newMessages.length - 1
              if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                newMessages[lastIdx] = {
                  ...newMessages[lastIdx],
                  content: accumulatedTextRef.current,
                }
              }
              return newMessages
            })
          }
          break

        case 'text-end':
          // Text block ended - nothing special needed
          break

        case 'tool-input-start':
          // Tool call starting
          if (onToolCallEvent) {
            onToolCallEvent(
              {
                type: 'tool-start',
                toolCallId: agentEvent.toolCallId as string,
                toolName: agentEvent.toolName as string,
                textLengthAtEvent: accumulatedTextRef.current.length,
              },
              currentMessageIdRef.current
            )
          }
          break

        case 'tool-input-available':
          // Tool input is available
          if (onToolCallEvent) {
            onToolCallEvent(
              {
                type: 'tool-input',
                toolCallId: agentEvent.toolCallId as string,
                toolName: agentEvent.toolName as string,
                input: agentEvent.input,
                textLengthAtEvent: accumulatedTextRef.current.length,
              },
              currentMessageIdRef.current
            )
          }
          break

        case 'tool-output-available':
          // Tool output is available
          if (onToolCallEvent) {
            onToolCallEvent(
              {
                type: 'tool-output',
                toolCallId: agentEvent.toolCallId as string,
                output: agentEvent.output,
                textLengthAtEvent: accumulatedTextRef.current.length,
              },
              currentMessageIdRef.current
            )
          }
          break

        case 'finish-step':
          // A step (tool call) finished - nothing special needed
          break

        case 'finish':
          // Generation finished
          isStreamingRef.current = false
          break

        case 'error':
          // Error occurred
          const errorText = (agentEvent.errorText as string) || 'Unknown error'
          setError(new Error(errorText))
          setStatus('error')
          isStreamingRef.current = false
          break

        case 'done':
          // Stream complete
          isStreamingRef.current = false
          setStatus('ready')
          log('Chat', 'Stream complete', { finalText: accumulatedTextRef.current.slice(0, 100) })
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onToolCallEvent])

  // Send a message
  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim()) {
        log('Chat', 'Blocked: empty message')
        return
      }

      if (isStreamingRef.current) {
        log('Chat', 'Blocked: already streaming')
        return
      }

      log('Chat', `Sending message: "${content.slice(0, 50)}..."`)

      // Generate a unique ID for the user message
      const userMessageId = `user_${Date.now()}`

      // Add user message to state
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: content.trim(),
      }

      setMessages(prev => [...prev, userMessage])
      setStatus('submitted')
      setError(null)

      // Send to extension
      // Include all messages for context (agent needs conversation history)
      const allMessages = [
        ...messages.map(m => ({ id: m.id, role: m.role, content: m.content })),
        { id: userMessageId, role: 'user', content: content.trim() },
      ]

      VSCodeAPI.postMessage({
        type: 'chat',
        messages: allMessages,
        threadId: threadId || undefined,
      })
    },
    [messages, threadId]
  )

  // Stop generation (placeholder - would need backend support)
  const stop = useCallback(() => {
    log('Chat', 'Stop requested (not fully implemented)')
    // TODO: Send cancel message to extension
    isStreamingRef.current = false
    setStatus('ready')
  }, [])

  // Derived loading state
  const isLoading = status === 'submitted' || status === 'streaming'

  return {
    messages,
    setMessages,
    status,
    error,
    sendMessage,
    stop,
    threadId,
    setThreadId,
    isLoading,
  }
}
