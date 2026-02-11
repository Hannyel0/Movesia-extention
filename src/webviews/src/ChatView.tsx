import React, { useRef, useEffect, useState, memo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles, Settings, StopCircle, FolderSync, LogOut, User } from 'lucide-react'
import { Button } from './lib/components/ui/button'
import { cn } from './lib/utils'
import { MarkdownRenderer } from './lib/components/MarkdownRenderer'
import { ChatInput } from './lib/components/ChatInput'
import { ThreadSelector } from './lib/components/ThreadSelector'
import { UnityStatusIndicator } from './lib/components/UnityStatusIndicator'
import { Avatar, AvatarImage, AvatarFallback } from './lib/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './lib/components/ui/dropdown-menu'
import {
  ToolCallList,
  ToolUIWrapper,
  ensureCustomToolUIsRegistered,
  getToolRegistration,
  getToolUIComponent,
} from './lib/components/tools'
import type { ToolUIProps, ToolCallData } from './lib/components/tools'

// Hooks
import { useChatState, type ChatMessage, type ToolCallEvent } from './lib/hooks/useChatState'
import { useToolCalls } from './lib/hooks/useToolCalls'
import { useThreads } from './lib/hooks/useThreads'
import { useSelectedProject } from './lib/hooks/useSelectedProject'
import { useProjectMessages } from './lib/hooks/useProjectMessages'
import { useAuthState } from './lib/hooks/useAuthState'
import VSCodeAPI from './lib/VSCodeAPI'
import { generateMessageSegments } from './lib/utils/messageSegments'
import type { DisplayMessage, MessageSegment } from './lib/types/chat'
import type { ProjectResponseType } from './lib/types/project'

// Initialize custom tool UIs on module load
ensureCustomToolUIsRegistered()

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

function ChatView() {
  const navigate = useNavigate()
  const [inputValue, setInputValue] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auth state for user info & sign-out
  const { authState, signOut } = useAuthState()

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
          console.log('[ChatView] Unity not open (Temp folder missing), redirecting to install screen')
          navigate('/installPackage', {
            state: { projectPath: selectedProjectPath },
          })
        } else {
          console.log('[ChatView] Unity is open, staying on chat')
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

  // Ref to store tool call event handler for the chat hook
  const toolCallEventHandlerRef = useRef<
    ((event: ToolCallEvent, messageId: string) => void) | null
  >(null)

  // Custom chat state hook (replaces AI SDK useChat)
  const {
    messages,
    setMessages,
    status,
    error,
    sendMessage,
    stop,
    threadId,
    setThreadId,
    isLoading,
  } = useChatState({
    onToolCallEvent: (event, messageId) => {
      // Forward to the tool calls hook
      if (toolCallEventHandlerRef.current) {
        // Convert to the format expected by useToolCalls
        toolCallEventHandlerRef.current(event, messageId)
      }
    },
  })

  // Tool calls management hook
  const { handleToolCallEvent, clearToolCalls, loadToolCalls, getToolCallsForMessage } = useToolCalls({
    status,
    messages: messages as Array<{ role: string }>,
  })

  // Store the handler in ref for the chat hook to use
  toolCallEventHandlerRef.current = handleToolCallEvent

  // Use threads hook for thread management
  const {
    threadId: threadsThreadId,
    setThreadId: threadsSetThreadId,
    threads,
    handleSelectThread,
    handleNewThread,
    handleDeleteThread,
    fetchConversationDetails,
  } = useThreads({
    setMessages: (msgs) => {
      // Messages from useThreads are already in ChatMessage format with content as string
      setMessages(msgs)
    },
    onClearToolCalls: clearToolCalls,
    onLoadToolCalls: loadToolCalls,
  })

  // Sync thread IDs between chat hook and threads hook (bidirectional)
  // Use a ref to prevent ping-pong loops between the two effects
  const isSyncingThreadIdRef = useRef(false)

  useEffect(() => {
    if (isSyncingThreadIdRef.current) return
    if (threadId && threadId !== threadsThreadId) {
      // Chat hook got a new thread ID (e.g., from backend after first message) → sync to threads hook
      isSyncingThreadIdRef.current = true
      threadsSetThreadId(threadId)
      fetchConversationDetails(threadId)
      // Reset guard after React processes the state update
      queueMicrotask(() => { isSyncingThreadIdRef.current = false })
    }
  }, [threadId, threadsThreadId, threadsSetThreadId, fetchConversationDetails])

  useEffect(() => {
    if (isSyncingThreadIdRef.current) return
    if (threadsThreadId && threadsThreadId !== threadId) {
      // Threads hook got a new thread ID (e.g., user selected an old thread) → sync to chat hook
      isSyncingThreadIdRef.current = true
      setThreadId(threadsThreadId)
      // Reset guard after React processes the state update
      queueMicrotask(() => { isSyncingThreadIdRef.current = false })
    }
  }, [threadsThreadId, threadId, setThreadId])

  // Use threadId from chat hook if available, otherwise from threads hook
  const effectiveThreadId = threadId || threadsThreadId

  log('Component', 'ChatView render', { threadId: effectiveThreadId, inputValue: inputValue.slice(0, 20) })

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
      sendMessage(messageContent)
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
        sendMessage(text)
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
    threadsSetThreadId(null)
    clearToolCalls()
  }, [setMessages, setThreadId, threadsSetThreadId, clearToolCalls])

  const handleStop = useCallback(() => {
    log('Stop', 'Stopping generation')
    stop()
  }, [stop])

  // Convert messages to display format with interleaved segments
  const displayMessages: DisplayMessage[] = messages.map((msg, index) => {
    let toolCallArray: ToolCallData[] = []
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
      if (toolCallArray.length > 0 || msg.content) {
        segments = generateMessageSegments(msg.content, toolCallArray)
      }
    }

    return {
      id: msg.id,
      role: msg.role,
      content: msg.content,
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
          <UnityStatusIndicator />
          <ThreadSelector
            threads={threads}
            currentThreadId={effectiveThreadId}
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

          {/* User avatar with sign-out dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full" title={authState.user?.name || 'Account'}>
                <Avatar className="h-6 w-6">
                  {authState.user?.picture && (
                    <AvatarImage src={authState.user.picture} alt={authState.user.name || 'User'} />
                  )}
                  <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
                    {authState.user?.name
                      ? authState.user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                      : <User className="w-3 h-3" />}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{authState.user?.name || 'User'}</p>
                  {authState.user?.email && (
                    <p className="text-xs leading-none text-muted-foreground">{authState.user.email}</p>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive cursor-pointer">
                <LogOut className="w-4 h-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
        onStop={handleStop}
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
 */
function ToolRenderer({ tool }: { tool: ToolCallData }) {
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
