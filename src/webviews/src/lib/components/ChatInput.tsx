import { useRef, useEffect, KeyboardEvent } from 'react'
import { Send, Loader2, Sparkles, Wrench, Mic, Search, Globe, ImageIcon, Paperclip } from 'lucide-react'
import { cn } from '../utils'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  isLoading: boolean
  placeholder?: string
}

export function ChatInput({
  value,
  onChange,
  onSend,
  isLoading,
  placeholder = "Ask anything. Type @ for mentions and / for shortcuts.",
}: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div className="p-4">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex flex-col rounded-2xl bg-vscode-input-background border border-vscode-input-border overflow-hidden">
          {/* Input Row */}
          <div className="flex items-center px-4 py-3">
            <input
              ref={inputRef}
              value={value}
              onChange={e => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-sm text-vscode-input-foreground placeholder:text-vscode-input-placeholderForeground focus:outline-none"
              disabled={isLoading}
            />
          </div>

          {/* Bottom Action Bar */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-vscode-input-border">
            {/* Left Actions */}
            <div className="flex items-center gap-1">
              <button className="flex items-center justify-center w-8 h-8 rounded-lg bg-vscode-button-background hover:bg-vscode-button-hoverBackground transition-colors">
                <Search className="w-4 h-4 text-vscode-button-foreground" />
              </button>
              <button className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-vscode-toolbar-hoverBackground transition-colors text-vscode-descriptionForeground hover:text-foreground">
                <Sparkles className="w-4 h-4" />
              </button>
              <button className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-vscode-toolbar-hoverBackground transition-colors text-vscode-descriptionForeground hover:text-foreground">
                <Wrench className="w-4 h-4" />
              </button>
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-1">
              <button className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-vscode-toolbar-hoverBackground transition-colors text-vscode-descriptionForeground hover:text-foreground">
                <Globe className="w-4 h-4" />
              </button>
              <button className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-vscode-toolbar-hoverBackground transition-colors text-vscode-descriptionForeground hover:text-foreground">
                <ImageIcon className="w-4 h-4" />
              </button>
              <button className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-vscode-toolbar-hoverBackground transition-colors text-vscode-descriptionForeground hover:text-foreground">
                <Paperclip className="w-4 h-4" />
              </button>
              <button className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-vscode-toolbar-hoverBackground transition-colors text-vscode-descriptionForeground hover:text-foreground">
                <Mic className="w-4 h-4" />
              </button>
              <button
                onClick={onSend}
                disabled={!value.trim() || isLoading}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-lg transition-colors ml-1",
                  value.trim() && !isLoading
                    ? "bg-vscode-button-background hover:bg-vscode-button-hoverBackground text-vscode-button-foreground"
                    : "bg-vscode-toolbar-hoverBackground text-vscode-descriptionForeground"
                )}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
