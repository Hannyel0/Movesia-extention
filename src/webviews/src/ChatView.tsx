import React, { useRef, useEffect, useState, memo, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { Loader2, Sparkles, Settings, StopCircle } from 'lucide-react'
import { Button } from './lib/components/ui/button'
import { cn } from './lib/utils'
import { MarkdownRenderer } from './lib/components/MarkdownRenderer'
import { ChatInput } from './lib/components/ChatInput'
import { ThreadSelector, type Thread } from './lib/components/ThreadSelector'
import { ToolCallList, type ToolCallData, type ToolCallState } from './lib/components/ToolCall'

// Configuration - update this to match your agent server
const API_BASE_URL = 'http://127.0.0.1:8765'

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

// Extended message type with tool calls display
interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallData[]
}

// Tool call tracker - stores tool calls for the current streaming session
// We track by backend message ID, and associate with the latest assistant message
interface StreamingToolCalls {
  backendMessageId: string
  tools: Map<string, ToolCallData>
}

// Helper function to extract text content from UIMessage parts
function getMessageTextContent(msg: UIMessage): string {
  if (!msg.parts) return ''
  return msg.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('')
}

// Tool call event types from SSE
interface ToolCallEvent {
  type: 'tool-start' | 'tool-input' | 'tool-output' | 'tool-error'
  toolCallId: string
  toolName?: string
  input?: unknown
  output?: unknown
  error?: string
}

type ToolCallEventCallback = (event: ToolCallEvent, messageId: string) => void

// Parse SSE stream and convert to UIMessageChunk stream
// Also extracts tool call events and forwards them to the callback
function createUIMessageChunkStream(
  response: Response,
  onToolCallEvent?: ToolCallEventCallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ReadableStream<any> {
  log('SSE', 'Creating UIMessageChunk stream from response')
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let chunkCount = 0
  let currentMessageId = ''

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()

        if (done) {
          log('SSE', 'Stream complete (done=true)')
          controller.close()
          return
        }

        const decoded = decoder.decode(value, { stream: true })
        buffer += decoded
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') {
              log('SSE', 'Received [DONE] signal')
              controller.close()
              return
            }
            try {
              const chunk = JSON.parse(data)
              chunkCount++

              // Log first few chunks and then every 10th
              if (chunkCount <= 3 || chunkCount % 10 === 0) {
                log('SSE', `Chunk #${chunkCount}: type=${chunk.type}`, chunk)
              }

              // Track message ID from start event
              if (chunk.type === 'start' && chunk.messageId) {
                currentMessageId = chunk.messageId
                log('SSE', `Message started: ${currentMessageId}`)
              }

              // Extract tool call events and forward to callback
              if (onToolCallEvent && currentMessageId) {
                if (chunk.type === 'tool-input-start') {
                  log('ToolTrack', `Tool start: ${chunk.toolName}`, chunk)
                  onToolCallEvent({
                    type: 'tool-start',
                    toolCallId: chunk.toolCallId,
                    toolName: chunk.toolName,
                  }, currentMessageId)
                } else if (chunk.type === 'tool-input-available') {
                  log('ToolTrack', `Tool input available: ${chunk.toolName}`, chunk)
                  onToolCallEvent({
                    type: 'tool-input',
                    toolCallId: chunk.toolCallId,
                    toolName: chunk.toolName,
                    input: chunk.input,
                  }, currentMessageId)
                } else if (chunk.type === 'tool-output-available') {
                  log('ToolTrack', `Tool output available`, chunk)
                  onToolCallEvent({
                    type: 'tool-output',
                    toolCallId: chunk.toolCallId,
                    output: chunk.output,
                  }, currentMessageId)
                } else if (chunk.type === 'error') {
                  log('ToolTrack', `Error`, chunk)
                  // Note: errors might not have toolCallId
                }
              }

              controller.enqueue(chunk)
            } catch (parseErr) {
              log('SSE', `Failed to parse JSON: "${data.slice(0, 100)}"`, parseErr)
            }
          }
        }
      } catch (err) {
        log('SSE', 'Stream error', err)
        controller.error(err)
      }
    },
    cancel() {
      log('SSE', 'Stream cancelled')
      reader.cancel()
    },
  })
}

function ChatView() {
  const [inputValue, setInputValue] = useState('')
  const [threadId, setThreadId] = useState<string | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])
  // Track tool calls for current streaming response
  const [currentStreamTools, setCurrentStreamTools] = useState<StreamingToolCalls | null>(null)
  // Track completed tool calls by the index of the assistant message (0-indexed among assistant messages only)
  const [completedToolCalls, setCompletedToolCalls] = useState<Map<number, ToolCallData[]>>(new Map())
  const scrollRef = useRef<HTMLDivElement>(null)

  // Ref to always have access to current threadId in transport closure
  const threadIdRef = useRef<string | null>(null)
  threadIdRef.current = threadId // Keep ref in sync with state

  log('Component', 'ChatView render', { threadId, inputValue: inputValue.slice(0, 20) })

  // Handle tool call events from SSE stream
  const handleToolCallEvent = useCallback((event: ToolCallEvent, messageId: string) => {
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
  }, [])

  // Fetch conversation details from backend and add to threads list
  const fetchConversationDetails = useCallback(async (id: string) => {
    log('Thread', `>>> fetchConversationDetails called with id: ${id}`)
    try {
      const url = `${API_BASE_URL}/api/conversations/${id}`
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
  }, [])

  // Vercel AI SDK v6 useChat hook with custom transport
  const {
    messages,
    setMessages,
    status,
    error,
    sendMessage,
    stop,
  } = useChat({
    // Custom transport for our Python backend
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport: {
      sendMessages: async ({ messages: chatMessages, abortSignal }) => {
        // Use ref to get current threadId (avoids stale closure)
        const currentThreadId = threadIdRef.current

        log('Transport', '='.repeat(50))
        log('Transport', 'sendMessages called', { messageCount: chatMessages.length, threadId: currentThreadId })

        const requestBody = {
          messages: chatMessages.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: getMessageTextContent(msg),
          })),
          threadId: currentThreadId,
        }

        log('Transport', 'Request body', requestBody)

        try {
          log('Transport', `Fetching ${API_BASE_URL}/api/chat`)
          const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(currentThreadId ? { 'x-thread-id': currentThreadId } : {}),
            },
            body: JSON.stringify(requestBody),
            signal: abortSignal,
          })

          log('Transport', `Response status: ${response.status}`)
          log('Transport', 'Response headers', Object.fromEntries(response.headers.entries()))

          // Capture thread ID from response headers
          const newThreadId = response.headers.get('x-thread-id')
          log('Transport', `x-thread-id header value: ${newThreadId}`)
          if (newThreadId && newThreadId !== currentThreadId) {
            log('Transport', `New thread ID received: ${newThreadId}`)
            setThreadId(newThreadId)
            // Fetch conversation details to get the title
            fetchConversationDetails(newThreadId)
          } else if (!newThreadId) {
            log('Transport', 'WARNING: No x-thread-id header in response!')
          }

          if (!response.ok) {
            const errorText = await response.text()
            log('Transport', `HTTP error: ${response.status}`, errorText)
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
          }

          log('Transport', 'Creating SSE stream...')
          // Parse SSE and return UIMessageChunk stream
          // Pass tool call event handler to extract tool calls from stream
          return createUIMessageChunkStream(response, handleToolCallEvent)
        } catch (err) {
          log('Transport', 'Fetch error', err)
          throw err
        }
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  })

  // Log status changes and save tool calls when streaming ends
  const prevStatusRef = useRef(status)
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
          log('Status', `Saving ${toolsArray.length} tool calls for assistant ${assistantIndex}`)

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

  // Log threads changes
  useEffect(() => {
    log('Threads', `Threads state updated, count: ${threads.length}`, threads)
  }, [threads])

  // Fetch threads from backend on mount
  useEffect(() => {
    const fetchThreads = async () => {
      try {
        log('Threads', 'Fetching threads from backend...')
        const response = await fetch(`${API_BASE_URL}/api/conversations`)
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
  }, [])

  // Log error changes
  useEffect(() => {
    if (error) {
      log('Error', 'Error state updated', error)
    }
  }, [error])

  // Log message changes (only when message count changes, not during streaming)
  const prevMessageCountRef = useRef(0)
  useEffect(() => {
    if (messages.length !== prevMessageCountRef.current) {
      log('Messages', `Messages count changed: ${prevMessageCountRef.current} -> ${messages.length}`)
      prevMessageCountRef.current = messages.length
    }
  }, [messages])

  // Derive loading state from status
  const isLoading = status === 'streaming' || status === 'submitted'

  // Auto-scroll to bottom when new messages arrive or content updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) {
      log('Send', 'Blocked: empty input or loading', { inputValue: inputValue.trim(), isLoading })
      return
    }

    const messageContent = inputValue.trim()
    log('Send', `Sending message: "${messageContent.slice(0, 50)}..."`)
    setInputValue('')

    try {
      // Send message using AI SDK v6 API with parts
      await sendMessage({
        role: 'user',
        parts: [{ type: 'text', text: messageContent }],
      })
      log('Send', 'sendMessage completed')
    } catch (err) {
      log('Send', 'sendMessage error', err)
    }
  }, [inputValue, isLoading, sendMessage])

  const handleSuggestionClick = useCallback(
    async (text: string) => {
      if (isLoading) {
        log('Suggestion', 'Blocked: loading')
        return
      }
      log('Suggestion', `Clicking suggestion: "${text}"`)
      try {
        await sendMessage({
          role: 'user',
          parts: [{ type: 'text', text }],
        })
      } catch (err) {
        log('Suggestion', 'Error', err)
      }
    },
    [isLoading, sendMessage]
  )

  const clearChat = useCallback(() => {
    log('Clear', 'Clearing chat')
    setMessages([])
    setThreadId(null)
    setCurrentStreamTools(null)
    setCompletedToolCalls(new Map())
  }, [setMessages])

  // Thread handlers
  const handleSelectThread = useCallback(
    async (id: string) => {
      log('Thread', `Selected thread: ${id}`)
      setThreadId(id)
      // Clear tool call tracking when switching threads
      setCurrentStreamTools(null)
      setCompletedToolCalls(new Map())

      // Load messages for this thread from backend
      try {
        log('Thread', `Fetching messages for thread: ${id}`)
        const response = await fetch(`${API_BASE_URL}/api/conversations/${id}/messages`)

        if (!response.ok) {
          log('Thread', `Failed to fetch messages: ${response.status}`)
          return
        }

        const messagesData = await response.json()
        log('Thread', `Loaded ${messagesData.length} messages`, messagesData)

        // Convert backend messages to UIMessage format for the AI SDK
        const uiMessages: UIMessage[] = messagesData.map(
          (msg: { role: string; content: string }, index: number) => ({
            id: `${id}-${index}`,
            role: msg.role as 'user' | 'assistant',
            parts: [{ type: 'text' as const, text: msg.content }],
          })
        )

        setMessages(uiMessages)
        log('Thread', `Set ${uiMessages.length} messages in state`)
      } catch (err) {
        log('Thread', 'Error fetching thread messages', err)
      }
    },
    [setMessages]
  )

  const handleNewThread = useCallback(() => {
    log('Thread', 'Creating new thread')
    setThreadId(null)
    setMessages([])
    setCurrentStreamTools(null)
    setCompletedToolCalls(new Map())
  }, [setMessages])

  const handleDeleteThread = useCallback(
    async (id: string) => {
      log('Thread', `Deleting thread: ${id}`)

      // Delete from backend
      try {
        const response = await fetch(`${API_BASE_URL}/api/conversations/${id}`, {
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
    [threadId, setMessages]
  )

  const handleStop = useCallback(() => {
    log('Stop', 'Stopping generation')
    stop()
  }, [stop])

  // Convert AI SDK v6 UIMessage to display format
  // Use our independently tracked tool calls instead of AI SDK parts
  const displayMessages: DisplayMessage[] = messages.map((msg, index) => {
    // Extract text content from parts
    const textContent = getMessageTextContent(msg)

    // For assistant messages, check if this is the last one (currently streaming)
    // and attach our tracked tool calls
    let toolCallArray: ToolCallData[] = []

    if (msg.role === 'assistant') {
      // Count assistant messages to get the index
      const assistantIndex = messages
        .slice(0, index + 1)
        .filter(m => m.role === 'assistant').length - 1

      // Check if this is the last assistant message and we have streaming tools
      const isLastAssistant = messages
        .slice(index + 1)
        .every(m => m.role !== 'assistant')

      if (isLastAssistant && currentStreamTools && currentStreamTools.tools.size > 0) {
        // This is the streaming message - use current stream tools
        toolCallArray = Array.from(currentStreamTools.tools.values())
        log('DisplayMsg', `Using stream tools for assistant ${assistantIndex}`, {
          count: toolCallArray.length,
        })
      } else {
        // Check completed tool calls
        const completed = completedToolCalls.get(assistantIndex)
        if (completed) {
          toolCallArray = completed
        }
      }
    }

    return {
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      content: textContent,
      toolCalls: toolCallArray.length > 0 ? toolCallArray : undefined,
    }
  })

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2 border-b border-border">
        <ThreadSelector
          threads={threads}
          currentThreadId={threadId}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          onDeleteThread={handleDeleteThread}
        />
        <Button variant="ghost" size="icon" onClick={clearChat} title="Settings">
          <Settings className="w-4 h-4" />
        </Button>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
        <div className="space-y-4">
          {displayMessages.length === 0 ? (
            <EmptyState onSuggestionClick={handleSuggestionClick} />
          ) : (
            displayMessages.map(message => <ChatMessage key={message.id} message={message} />)
          )}

          {/* Error display */}
          {error && (
            <div className="flex items-center gap-2 py-2 px-4 rounded-lg bg-destructive/10 text-destructive">
              <span className="text-sm">Error: {error.message}</span>
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && displayMessages[displayMessages.length - 1]?.role === 'user' && (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Thinking...</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStop}
                className="ml-2 h-6 px-2 text-xs"
              >
                <StopCircle className="w-3 h-3 mr-1" />
                Stop
              </Button>
            </div>
          )}
        </div>
      </div>

      <ChatInput
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSendMessage}
        isLoading={isLoading}
      />
    </div>
  )
}

interface ChatMessageProps {
  message: DisplayMessage
}

// Memoized to prevent re-renders when typing in input
const ChatMessage = memo(function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('py-2', isUser && 'text-right')}>
      {isUser ? (
        <div className="inline-block px-4 py-2 rounded-2xl bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border/50 max-w-[80%] text-left">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
      ) : (
        <div className="text-left">
          {/* Tool calls display - using new component */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallList tools={message.toolCalls} />
          )}
          {/* Main content */}
          {message.content && <MarkdownRenderer content={message.content} />}
        </div>
      )}
    </div>
  )
})


interface EmptyStateProps {
  onSuggestionClick: (text: string) => void
}

function EmptyState({ onSuggestionClick }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center px-4">
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
        <Sparkles className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-lg font-semibold mb-2">Welcome to Movesia AI</h2>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        Your intelligent assistant for Unity Editor. Ask questions about game development, get help
        with scripts, or manage your Unity project.
      </p>
      <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
        <SuggestionButton text="How do I create a new GameObject?" onClick={onSuggestionClick} />
        <SuggestionButton text="Help me write a movement script" onClick={onSuggestionClick} />
        <SuggestionButton text="What prefabs are in my project?" onClick={onSuggestionClick} />
      </div>
    </div>
  )
}

interface SuggestionButtonProps {
  text: string
  onClick: (text: string) => void
}

function SuggestionButton({ text, onClick }: SuggestionButtonProps) {
  return (
    <Button
      variant="outline"
      className="justify-start text-left h-auto py-3 px-4 text-sm"
      onClick={() => onClick(text)}
    >
      <Sparkles className="w-4 h-4 mr-2 text-primary shrink-0" />
      <span className="truncate">{text}</span>
    </Button>
  )
}

export default ChatView
