import React, { useRef, useEffect, useState, memo, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { useNavigate } from 'react-router-dom'
import type { UIMessage } from 'ai'
import { Loader2, Sparkles, Settings, StopCircle, FolderSync } from 'lucide-react'
import { Button } from './lib/components/ui/button'
import { cn } from './lib/utils'
import { MarkdownRenderer } from './lib/components/MarkdownRenderer'
import { ChatInput } from './lib/components/ChatInput'
import { ThreadSelector } from './lib/components/ThreadSelector'
import { UnityStatusIndicator } from './lib/components/UnityStatusIndicator'
import {
  ToolCallList,
  ToolUIWrapper,
  ensureCustomToolUIsRegistered,
  getToolRegistration,
  getToolUIComponent,
} from './lib/components/tools'
import type { ToolUIProps } from './lib/components/tools'

// Extracted modules
import { createUIMessageChunkStream } from './lib/streaming/sseParser'
import { useToolCalls } from './lib/hooks/useToolCalls'
import { useThreads } from './lib/hooks/useThreads'
import { useSelectedProject } from './lib/hooks/useSelectedProject'
import { useProjectMessages } from './lib/hooks/useProjectMessages'
import VSCodeAPI from './lib/VSCodeAPI'
import { generateMessageSegments } from './lib/utils/messageSegments'
import type { DisplayMessage, MessageSegment } from './lib/types/chat'
import type { ProjectResponseType } from './lib/types/project'

// Initialize custom tool UIs on module load
ensureCustomToolUIsRegistered()

// Configuration
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

// Helper function to extract text content from UIMessage parts
function getMessageTextContent(msg: UIMessage): string {
  if (!msg.parts) return ''
  return msg.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('')
}

function ChatView() {
  const navigate = useNavigate()
  const [inputValue, setInputValue] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Track if we've done the initial check
  const hasCheckedRef = useRef(false)
  const [isInitializing, setIsInitializing] = useState(true)

  // Get selected project path for redirect and Unity running check
  const { projectPath: selectedProjectPath, isLoading: isLoadingProject } = useSelectedProject()

  // Project messages hook for change project functionality
  const { clearSelectedProject } = useProjectMessages(() => {})

  // Handle changing the project
  const handleChangeProject = useCallback(() => {
    clearSelectedProject()
    navigate('/projectSelector')
  }, [clearSelectedProject, navigate])

  // MANUAL ONE-TIME UNITY CHECK (no hook to avoid race conditions)
  // This effect sends the check request and sets up a listener for the response
  useEffect(() => {
    // Wait for project path to load first
    if (isLoadingProject) {
      console.log('[ChatView] Waiting for project path to load...')
      return
    }

    // If no project path, redirect to project selector
    if (!selectedProjectPath) {
      console.log('[ChatView] No project path, redirecting to project selector')
      navigate('/projectSelector')
      return
    }

    // Only do this check once
    if (hasCheckedRef.current) {
      console.log('[ChatView] Already checked Unity status, skipping')
      return
    }

    console.log('[ChatView] Starting manual Unity check for:', selectedProjectPath)

    // Set up message listener BEFORE sending the request
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ProjectResponseType

      // Only handle the response for our specific project
      if (message.type === 'unityRunningStatus' && message.projectPath === selectedProjectPath) {
        console.log('[ChatView] Received Unity running status response:', {
          projectPath: message.projectPath,
          isRunning: message.isRunning,
        })

        // Mark as checked so we don't repeat
        hasCheckedRef.current = true

        // Clean up listener immediately
        window.removeEventListener('message', handleMessage)

        // Now make the decision based on actual response
        if (!message.isRunning) {
          console.log('[ChatView] ❌ Unity not open (Temp folder missing), redirecting to install screen')
          navigate('/installPackage', {
            state: { projectPath: selectedProjectPath },
          })
        } else {
          console.log('[ChatView] ✅ Unity is open, staying on chat')
          setIsInitializing(false)
        }
      }
    }

    // Add listener
    window.addEventListener('message', handleMessage)

    // Send the check request
    console.log('[ChatView] Sending checkUnityRunning message...')
    VSCodeAPI.postMessage({
      type: 'checkUnityRunning',
      projectPath: selectedProjectPath,
    })

    // Cleanup if component unmounts before response
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [selectedProjectPath, isLoadingProject, navigate])

  // We need a ref to store handleToolCallEvent since it's used in the transport
  // but the transport is defined before we have access to the hook
  const toolCallEventHandlerRef = useRef<
    ((event: Parameters<typeof handleToolCallEvent>[0], messageId: string) => void) | null
  >(null)

  // Vercel AI SDK v6 useChat hook with custom transport
  const { messages, setMessages, status, error, sendMessage, stop } = useChat({
    // Custom transport for our Python backend
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport: {
      sendMessages: async ({ messages: chatMessages, abortSignal }) => {
        // Use ref to get current threadId (avoids stale closure)
        const currentThreadId = threadIdRef.current

        log('Transport', '='.repeat(50))
        log('Transport', 'sendMessages called', {
          messageCount: chatMessages.length,
          threadId: currentThreadId,
        })

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
          return createUIMessageChunkStream(
            response,
            toolCallEventHandlerRef.current || undefined
          )
        } catch (err) {
          log('Transport', 'Fetch error', err)
          throw err
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  })

  // Now we can use our custom hooks with the AI SDK values
  const { handleToolCallEvent, clearToolCalls, loadToolCalls, getToolCallsForMessage } = useToolCalls({
    status,
    messages,
  })

  // Store the handler in ref for the transport to use
  toolCallEventHandlerRef.current = handleToolCallEvent

  // Ref to always have access to current threadId in transport closure
  const threadIdRef = useRef<string | null>(null)

  const {
    threadId,
    setThreadId,
    threads,
    handleSelectThread,
    handleNewThread,
    handleDeleteThread,
    fetchConversationDetails,
  } = useThreads({
    apiBaseUrl: API_BASE_URL,
    setMessages,
    onClearToolCalls: clearToolCalls,
    onLoadToolCalls: loadToolCalls,
  })

  // Keep ref in sync with state
  threadIdRef.current = threadId

  log('Component', 'ChatView render', { threadId, inputValue: inputValue.slice(0, 20) })

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
      log('Send', 'Blocked: empty input or loading', {
        inputValue: inputValue.trim(),
        isLoading,
      })
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
    clearToolCalls()
  }, [setMessages, setThreadId, clearToolCalls])

  const handleStop = useCallback(() => {
    log('Stop', 'Stopping generation')
    stop()
  }, [stop])

  // Convert AI SDK v6 UIMessage to display format with interleaved segments
  const displayMessages: DisplayMessage[] = messages.map((msg, index) => {
    const textContent = getMessageTextContent(msg)

    let toolCallArray: DisplayMessage['toolCalls'] = []
    let segments: MessageSegment[] | undefined

    if (msg.role === 'assistant') {
      // Count assistant messages to get the index
      const assistantIndex = messages
        .slice(0, index + 1)
        .filter(m => m.role === 'assistant').length - 1

      // Check if this is the last assistant message
      const isLastAssistant = messages.slice(index + 1).every(m => m.role !== 'assistant')

      toolCallArray = getToolCallsForMessage(assistantIndex, isLastAssistant)

      // Generate interleaved segments for rendering
      if (toolCallArray.length > 0 || textContent) {
        segments = generateMessageSegments(textContent, toolCallArray)
      }
    }

    return {
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      content: textContent,
      toolCalls: toolCallArray.length > 0 ? toolCallArray : undefined,
      segments,
    }
  })

  // Show loading state while checking if Unity is open
  if (isInitializing || isLoadingProject) {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-[var(--vscode-sideBar-background)] text-foreground items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Checking if Unity is open...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--vscode-sideBar-background)] text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1">
          <UnityStatusIndicator apiBaseUrl={API_BASE_URL} />
          <ThreadSelector
            threads={threads}
            currentThreadId={threadId}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
            onDeleteThread={handleDeleteThread}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={handleChangeProject} title="Change Project">
            <FolderSync className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={clearChat} title="Settings">
            <Settings className="w-4 h-4" />
          </Button>
        </div>
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

/**
 * Renders a tool call UI, checking if it should use full custom mode.
 *
 * Full custom mode (fullCustom: true in registration) renders the component
 * directly without the standard ToolUIWrapper, giving complete control over
 * the visual presentation.
 */
function ToolRenderer({ tool }: { tool: import('./lib/components/tools').ToolCallData }) {
  const registration = getToolRegistration(tool.name)
  const CustomComponent = getToolUIComponent(tool.name)

  // Full custom mode: render component directly, no wrapper
  if (registration?.fullCustom && CustomComponent) {
    const isActive = tool.state === 'streaming' || tool.state === 'executing'
    const props: ToolUIProps = {
      tool,
      input: tool.input,
      output: tool.output,
      isExpanded: true,
      onToggleExpand: () => {},
      isActive,
    }
    return <CustomComponent {...props} />
  }

  // Standard mode: use wrapper with collapsible header
  return <ToolUIWrapper tool={tool} />
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
          {/* Render interleaved segments (text and tools in order) */}
          {message.segments && message.segments.length > 0 ? (
            message.segments.map((segment, idx) =>
              segment.type === 'text' ? (
                <MarkdownRenderer key={`text-${idx}`} content={segment.content} />
              ) : (
                <div key={`tool-${segment.tool.id}`} className="my-2">
                  <ToolRenderer tool={segment.tool} />
                </div>
              )
            )
          ) : (
            // Fallback for messages without segments (backward compatibility)
            <>
              {message.toolCalls && message.toolCalls.length > 0 && (
                <ToolCallList tools={message.toolCalls} />
              )}
              {message.content && <MarkdownRenderer content={message.content} />}
            </>
          )}
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
