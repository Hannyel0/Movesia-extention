import { useState, useCallback, useEffect, useRef } from 'react'
import type { Thread } from '../components/ThreadSelector'
import type { ToolCallData } from '../components/tools'
import type { ChatMessage } from './useChatState'
import VSCodeAPI from '../VSCodeAPI'

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

// API response types
interface ToolCallApiResponse {
  id: string
  name: string
  input?: Record<string, unknown>
  output?: unknown
}

interface MessageApiResponse {
  role: string
  content: string
  tool_calls?: ToolCallApiResponse[]
}

interface UseThreadsOptions {
  /** Callback to set messages in the chat state */
  setMessages: (messages: ChatMessage[]) => void
  /** Callback when tool calls should be cleared */
  onClearToolCalls?: () => void
  /** Callback to load tool calls from persistence */
  onLoadToolCalls?: (toolCallsMap: Map<number, ToolCallData[]>) => void
}

interface UseThreadsReturn {
  /** Current thread ID */
  threadId: string | null
  /** Set the current thread ID */
  setThreadId: (id: string | null) => void
  /** List of all threads */
  threads: Thread[]
  /** Handle selecting a thread */
  handleSelectThread: (id: string) => void
  /** Handle creating a new thread */
  handleNewThread: () => void
  /** Handle deleting a thread */
  handleDeleteThread: (id: string) => void
  /** Fetch conversation details and update thread title */
  fetchConversationDetails: (id: string) => void
}

/**
 * Hook to manage thread/conversation state via VS Code postMessage.
 *
 * Handles:
 * - Loading threads from agent service on mount
 * - Selecting threads and loading their messages
 * - Creating new threads
 * - Deleting threads
 * - Updating thread titles from conversation details
 */
export function useThreads({
  setMessages,
  onClearToolCalls,
  onLoadToolCalls,
}: UseThreadsOptions): UseThreadsReturn {
  const [threadId, setThreadId] = useState<string | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])

  // Track pending operations to associate responses with requests
  const pendingSelectRef = useRef<string | null>(null)
  const pendingDetailsRef = useRef<string | null>(null)

  // Set up message listener for responses from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data

      switch (message.type) {
        case 'threadsLoaded':
          // Response to getThreads request
          log('Threads', 'Threads loaded from backend', message.threads)
          const loadedThreads: Thread[] = (message.threads || []).map(
            (conv: { session_id: string; title: string | null; created_at: string }) => ({
              id: conv.session_id,
              title: conv.title || 'New Chat',
              createdAt: new Date(conv.created_at),
              messageCount: 0,
            })
          )
          setThreads(loadedThreads)
          log('Threads', `Loaded ${loadedThreads.length} threads from backend`)
          break

        case 'threadMessagesLoaded':
          // Response to getThreadMessages request
          if (message.threadId === pendingSelectRef.current) {
            pendingSelectRef.current = null
            const messagesData: MessageApiResponse[] = message.messages || []
            log('Thread', `Loaded ${messagesData.length} messages`, messagesData)

            // Convert backend messages to ChatMessage format
            // Also extract tool calls to populate the completedToolCalls map
            const toolCallsMap = new Map<number, ToolCallData[]>()
            let assistantIndex = 0

            const chatMessages: ChatMessage[] = messagesData.map((msg, index) => {
              // If this is an assistant message with tool calls, extract them
              if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                const toolCalls: ToolCallData[] = msg.tool_calls.map(tc => ({
                  id: tc.id,
                  name: tc.name,
                  state: 'completed' as const,
                  input: tc.input,
                  output: tc.output,
                }))
                toolCallsMap.set(assistantIndex, toolCalls)
                log('Thread', `Extracted ${toolCalls.length} tool calls for assistant message ${assistantIndex}`, toolCalls)
              }

              // Increment assistant index after processing
              if (msg.role === 'assistant') {
                assistantIndex++
              }

              return {
                id: `${message.threadId}-${index}`,
                role: msg.role as 'user' | 'assistant',
                content: msg.content,
              }
            })

            // Load tool calls into the hook state
            if (toolCallsMap.size > 0 && onLoadToolCalls) {
              log('Thread', `Loading ${toolCallsMap.size} tool call entries into state`)
              onLoadToolCalls(toolCallsMap)
            }

            setMessages(chatMessages)
            log('Thread', `Set ${chatMessages.length} messages in state`)
          }
          break

        case 'threadDeleted':
          // Response to deleteThread request
          log('Thread', `Thread deleted: ${message.threadId}`)
          setThreads(prev => prev.filter(t => t.id !== message.threadId))
          if (threadId === message.threadId) {
            setThreadId(null)
            setMessages([])
          }
          break

        case 'conversationDetails':
          // Response to getConversationDetails request
          if (message.threadId === pendingDetailsRef.current) {
            pendingDetailsRef.current = null
            const title = message.title || 'New Chat'
            log('Thread', `Conversation details received, title: "${title}"`)

            // Add the new thread to the list (or update if exists)
            setThreads(prev => {
              const exists = prev.some(t => t.id === message.threadId)
              if (exists) {
                return prev.map(t => (t.id === message.threadId ? { ...t, title } : t))
              } else {
                return [
                  {
                    id: message.threadId,
                    title,
                    createdAt: new Date(),
                    messageCount: 1,
                  },
                  ...prev,
                ]
              }
            })
          }
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [setMessages, onLoadToolCalls, threadId])

  // Fetch threads from backend on mount
  useEffect(() => {
    log('Threads', 'Requesting threads from backend...')
    VSCodeAPI.postMessage({ type: 'getThreads' })
  }, [])

  // Fetch conversation details from backend and add to threads list
  const fetchConversationDetails = useCallback((id: string) => {
    log('Thread', `>>> fetchConversationDetails called with id: ${id}`)
    pendingDetailsRef.current = id
    VSCodeAPI.postMessage({ type: 'getConversationDetails', threadId: id })
  }, [])

  // Handle selecting a thread
  const handleSelectThread = useCallback(
    (id: string) => {
      log('Thread', `Selected thread: ${id}`)
      setThreadId(id)
      // Clear tool call tracking when switching threads
      onClearToolCalls?.()

      // Request messages for this thread from backend
      log('Thread', `Requesting messages for thread: ${id}`)
      pendingSelectRef.current = id
      VSCodeAPI.postMessage({ type: 'getThreadMessages', threadId: id })
    },
    [onClearToolCalls]
  )

  // Handle creating a new thread
  const handleNewThread = useCallback(() => {
    log('Thread', 'Creating new thread')
    setThreadId(null)
    setMessages([])
    onClearToolCalls?.()
  }, [setMessages, onClearToolCalls])

  // Handle deleting a thread
  const handleDeleteThread = useCallback((id: string) => {
    log('Thread', `Deleting thread: ${id}`)
    VSCodeAPI.postMessage({ type: 'deleteThread', threadId: id })
  }, [])

  return {
    threadId,
    setThreadId,
    threads,
    handleSelectThread,
    handleNewThread,
    handleDeleteThread,
    fetchConversationDetails,
  }
}
