import { useState, useCallback, useEffect } from 'react'
import type { Thread } from '../components/ThreadSelector'
import type { UIMessage } from 'ai'
import type { ToolCallData } from '../components/ToolCall'

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
  /** Base URL for the API */
  apiBaseUrl: string
  /** Callback to set messages in the AI SDK */
  setMessages: (messages: UIMessage[]) => void
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
  handleSelectThread: (id: string) => Promise<void>
  /** Handle creating a new thread */
  handleNewThread: () => void
  /** Handle deleting a thread */
  handleDeleteThread: (id: string) => Promise<void>
  /** Fetch conversation details and update thread title */
  fetchConversationDetails: (id: string) => Promise<void>
}

/**
 * Hook to manage thread/conversation state.
 *
 * Handles:
 * - Loading threads from backend on mount
 * - Selecting threads and loading their messages
 * - Creating new threads
 * - Deleting threads
 * - Updating thread titles from conversation details
 */
export function useThreads({
  apiBaseUrl,
  setMessages,
  onClearToolCalls,
  onLoadToolCalls,
}: UseThreadsOptions): UseThreadsReturn {
  const [threadId, setThreadId] = useState<string | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])

  // Fetch conversation details from backend and add to threads list
  const fetchConversationDetails = useCallback(
    async (id: string) => {
      log('Thread', `>>> fetchConversationDetails called with id: ${id}`)
      try {
        const url = `${apiBaseUrl}/api/conversations/${id}`
        log('Thread', `Fetching: ${url}`)
        const response = await fetch(url)

        log('Thread', `Response status: ${response.status}`)

        if (!response.ok) {
          const errorText = await response.text()
          log('Thread', `Failed to fetch conversation: ${response.status}`, errorText)
          return
        }

        const data = await response.json()
        log('Thread', 'Conversation details received', data)

        const title = data.conversation?.title || 'New Chat'
        log('Thread', `Extracted title: "${title}"`)

        // Add the new thread to the list (or update if exists)
        setThreads(prev => {
          log('Thread', `setThreads called, prev threads count: ${prev.length}`, prev)
          const exists = prev.some(t => t.id === id)
          log('Thread', `Thread ${id} exists: ${exists}`)

          let newThreads: Thread[]
          if (exists) {
            newThreads = prev.map(t => (t.id === id ? { ...t, title } : t))
          } else {
            newThreads = [
              {
                id,
                title,
                createdAt: new Date(),
                messageCount: 1,
              },
              ...prev,
            ]
          }
          log('Thread', `New threads count: ${newThreads.length}`, newThreads)
          return newThreads
        })
      } catch (err) {
        log('Thread', 'Error fetching conversation details', err)
      }
    },
    [apiBaseUrl]
  )

  // Fetch threads from backend on mount
  useEffect(() => {
    const fetchThreads = async () => {
      try {
        log('Threads', 'Fetching threads from backend...')
        const response = await fetch(`${apiBaseUrl}/api/conversations`)
        if (!response.ok) {
          log('Threads', `Failed to fetch threads: ${response.status}`)
          return
        }
        const data = await response.json()
        log('Threads', 'Threads fetched from backend', data)

        const loadedThreads: Thread[] = data.conversations.map(
          (conv: { session_id: string; title: string | null; created_at: string }) => ({
            id: conv.session_id,
            title: conv.title || 'New Chat',
            createdAt: new Date(conv.created_at),
            messageCount: 0,
          })
        )

        setThreads(loadedThreads)
        log('Threads', `Loaded ${loadedThreads.length} threads from backend`)
      } catch (err) {
        log('Threads', 'Error fetching threads', err)
      }
    }

    fetchThreads()
  }, [apiBaseUrl])

  // Log threads changes
  useEffect(() => {
    log('Threads', `Threads state updated, count: ${threads.length}`, threads)
  }, [threads])

  // Handle selecting a thread
  const handleSelectThread = useCallback(
    async (id: string) => {
      log('Thread', `Selected thread: ${id}`)
      setThreadId(id)
      // Clear tool call tracking when switching threads
      onClearToolCalls?.()

      // Load messages for this thread from backend
      try {
        log('Thread', `Fetching messages for thread: ${id}`)
        const response = await fetch(`${apiBaseUrl}/api/conversations/${id}/messages`)

        if (!response.ok) {
          log('Thread', `Failed to fetch messages: ${response.status}`)
          return
        }

        const messagesData: MessageApiResponse[] = await response.json()
        log('Thread', `Loaded ${messagesData.length} messages`, messagesData)

        // Convert backend messages to UIMessage format for the AI SDK
        // Also extract tool calls to populate the completedToolCalls map
        const toolCallsMap = new Map<number, ToolCallData[]>()
        let assistantIndex = 0

        const uiMessages: UIMessage[] = messagesData.map((msg, index) => {
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
            id: `${id}-${index}`,
            role: msg.role as 'user' | 'assistant',
            parts: [{ type: 'text' as const, text: msg.content }],
          }
        })

        // Load tool calls into the hook state
        if (toolCallsMap.size > 0 && onLoadToolCalls) {
          log('Thread', `Loading ${toolCallsMap.size} tool call entries into state`)
          onLoadToolCalls(toolCallsMap)
        }

        setMessages(uiMessages)
        log('Thread', `Set ${uiMessages.length} messages in state`)
      } catch (err) {
        log('Thread', 'Error fetching thread messages', err)
      }
    },
    [apiBaseUrl, setMessages, onClearToolCalls, onLoadToolCalls]
  )

  // Handle creating a new thread
  const handleNewThread = useCallback(() => {
    log('Thread', 'Creating new thread')
    setThreadId(null)
    setMessages([])
    onClearToolCalls?.()
  }, [setMessages, onClearToolCalls])

  // Handle deleting a thread
  const handleDeleteThread = useCallback(
    async (id: string) => {
      log('Thread', `Deleting thread: ${id}`)

      // Delete from backend
      try {
        const response = await fetch(`${apiBaseUrl}/api/conversations/${id}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          log('Thread', `Failed to delete thread from backend: ${response.status}`)
        } else {
          log('Thread', `Thread deleted from backend: ${id}`)
        }
      } catch (err) {
        log('Thread', 'Error deleting thread from backend', err)
      }

      // Update local state
      setThreads(prev => prev.filter(t => t.id !== id))
      if (threadId === id) {
        setThreadId(null)
        setMessages([])
      }
    },
    [apiBaseUrl, threadId, setMessages]
  )

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
