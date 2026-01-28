import React, { useRef, useEffect, useState, memo } from 'react'
import { Loader2, Sparkles, Settings } from 'lucide-react'
import { Button } from './lib/components/ui/button'
import { cn } from './lib/utils'
import useVSCodeState from './lib/state/reactState'
import { getNextTestMessage, resetTestMessageIndex } from './testMessages'
import { MarkdownRenderer } from './lib/components/MarkdownRenderer'
import { ChatInput } from './lib/components/ChatInput'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

function ChatView() {
  const [messages, setMessages] = useVSCodeState<Message[]>([], 'chatMessages')
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    }

    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInputValue('')
    setIsLoading(true)

    // Test response - cycles through markdown test messages
    setTimeout(() => {
      const assistantMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: getNextTestMessage(),
        timestamp: new Date(),
      }
      setMessages([...updatedMessages, assistantMessage])
      setIsLoading(false)
    }, 500)
  }

  const clearChat = () => {
    setMessages([])
    resetTestMessageIndex()
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Movesia AI Assistant</h1>
            <p className="text-xs text-muted-foreground">Unity Editor Integration</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={clearChat} title="Clear chat">
          <Settings className="w-4 h-4" />
        </Button>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map(message => <ChatMessage key={message.id} message={message} />)
          )}

          {isLoading && (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Thinking...</span>
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
  message: Message
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
          <MarkdownRenderer content={message.content} />
        </div>
      )}
    </div>
  )
})

function EmptyState() {
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
        <SuggestionButton text="How do I create a new GameObject?" />
        <SuggestionButton text="Help me write a movement script" />
        <SuggestionButton text="What prefabs are in my project?" />
      </div>
    </div>
  )
}

interface SuggestionButtonProps {
  text: string
}

function SuggestionButton({ text }: SuggestionButtonProps) {
  return (
    <Button variant="outline" className="justify-start text-left h-auto py-3 px-4 text-sm">
      <Sparkles className="w-4 h-4 mr-2 text-primary shrink-0" />
      <span className="truncate">{text}</span>
    </Button>
  )
}

export default ChatView
