import React, { useRef, useEffect, useState, memo, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { Loader2, Sparkles, Settings, StopCircle } from 'lucide-react'
import { Button } from './lib/components/ui/button'
import { cn } from './lib/utils'
import { MarkdownRenderer } from './lib/components/MarkdownRenderer'
import { ChatInput } from './lib/components/ChatInput'
import { ThreadSelector, type Thread } from './lib/components/ThreadSelector'

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
  toolCalls?: Array<{
    id: string
    name: string
    input: unknown
    output?: unknown
  }>
}

// Helper function to extract text content from UIMessage parts
function getMessageTextContent(msg: UIMessage): string {
  if (!msg.parts) return ''
  return msg.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('')
}

// Parse SSE stream and convert to UIMessageChunk stream
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createUIMessageChunkStream(response: Response): ReadableStream<any> {
  log('SSE', 'Creating UIMessageChunk stream from response')
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let chunkCount = 0

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
  const scrollRef = useRef<HTMLDivElement>(null)

  // Ref to always have access to current threadId in transport closure
  const threadIdRef = useRef<string | null>(null)
  threadIdRef.current = threadId // Keep ref in sync with state

  log('Component', 'ChatView render', { threadId, inputValue: inputValue.slice(0, 20) })

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
          return createUIMessageChunkStream(response)
        } catch (err) {
          log('Transport', 'Fetch error', err)
          throw err
        }
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  })

  // Log status changes
  useEffect(() => {
    log('Status', `Status changed to: ${status}`)
  }, [status])

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
  }, [setMessages])

  // Thread handlers
  const handleSelectThread = useCallback(
    async (id: string) => {
      log('Thread', `Selected thread: ${id}`)
      setThreadId(id)

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
    // TODO: Create new thread
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
  const displayMessages: DisplayMessage[] = messages.map(msg => {
    // Extract text content from parts
    const textContent = getMessageTextContent(msg)

    // Extract tool invocations from parts (dynamic-tool type in v6)
    const toolCalls: DisplayMessage['toolCalls'] = []
    if (msg.parts) {
      for (const part of msg.parts) {
        if (part.type === 'dynamic-tool') {
          // Cast to access dynamic-tool specific properties
          const toolPart = part as unknown as {
            toolCallId: string
            toolName: string
            state: string
            input?: unknown
            output?: unknown
          }
          toolCalls.push({
            id: toolPart.toolCallId,
            name: toolPart.toolName,
            input: toolPart.input,
            output: toolPart.state === 'output-available' ? toolPart.output : undefined,
          })
        }
      }
    }

    return {
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
          {/* Tool calls display */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mb-2 space-y-2">
              {message.toolCalls.map(tool => (
                <ToolCallDisplay key={tool.id} tool={tool} />
              ))}
            </div>
          )}
          {/* Main content */}
          {message.content && <MarkdownRenderer content={message.content} />}
        </div>
      )}
    </div>
  )
})

interface ToolCallDisplayProps {
  tool: {
    id: string
    name: string
    input: unknown
    output?: unknown
  }
}

function ToolCallDisplay({ tool }: ToolCallDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center justify-center w-5 h-5 rounded bg-primary/20">
          <Settings className="w-3 h-3 text-primary" />
        </div>
        <span className="text-xs font-medium text-muted-foreground">Tool: {tool.name}</span>
        <span className="text-xs text-muted-foreground ml-auto">{isExpanded ? '▼' : '▶'}</span>
      </button>
      {isExpanded && (
        <div className="px-3 pb-2 text-xs">
          <div className="mb-1 text-muted-foreground">Input:</div>
          <pre className="p-2 rounded bg-muted/50 overflow-x-auto text-foreground">
            {JSON.stringify(tool.input, null, 2)}
          </pre>
          {tool.output !== undefined && (
            <>
              <div className="mt-2 mb-1 text-muted-foreground">Output:</div>
              <pre className="p-2 rounded bg-muted/50 overflow-x-auto text-foreground max-h-40 overflow-y-auto">
                {typeof tool.output === 'string' ? tool.output : JSON.stringify(tool.output, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

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
