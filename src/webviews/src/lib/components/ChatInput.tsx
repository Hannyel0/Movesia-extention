import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { ArrowUp, Square, Plus, Code, MessageCircle, ClipboardList, Check, ChevronDown } from 'lucide-react'
import { cn } from '../utils'

export type ChatMode = 'code' | 'chat' | 'plan'

const MODE_CONFIG: Record<ChatMode, { icon: typeof Code; label: string; description: string }> = {
  code: {
    icon: Code,
    label: 'Code',
    description: 'Can write and edit code',
  },
  chat: {
    icon: MessageCircle,
    label: 'Chat',
    description: 'Reads but won\'t edit',
  },
  plan: {
    icon: ClipboardList,
    label: 'Plan',
    description: 'Plan changes before implementing',
  },
}

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  isLoading: boolean
  placeholder?: string
  mode?: ChatMode
  onModeChange?: (mode: ChatMode) => void
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isLoading,
  placeholder = "Ask anything",
  mode: controlledMode,
  onModeChange,
}: ChatInputProps) {
  const [internalMode, setInternalMode] = useState<ChatMode>('code')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const mode = controlledMode ?? internalMode
  const setMode = (m: ChatMode) => {
    if (onModeChange) onModeChange(m)
    else setInternalMode(m)
  }

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  const currentConfig = MODE_CONFIG[mode]
  const CurrentIcon = currentConfig.icon

  return (
    <div className="px-4 pb-4 pt-2">
      <div
        className={cn(
          'relative flex flex-col rounded-xl bg-vscode-input-background overflow-visible transition-all max-w-3xl mx-auto',
          'shadow-sm',
          focused
            ? 'border border-vscode-input-border/60 shadow-md'
            : 'border border-transparent'
        )}
      >
        {/* Input Row */}
        <div className="flex items-center px-4 py-3">
          <input
            ref={inputRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-vscode-input-foreground placeholder:text-vscode-input-placeholderForeground focus:outline-none"
            disabled={isLoading}
          />
        </div>

        {/* Bottom Bar */}
        <div className="flex items-center justify-between px-2.5 pb-2.5">
          {/* Left: Plus + Mode selector */}
          <div className="flex items-center gap-1">
            {/* Plus button */}
            <button
              className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-vscode-toolbar-hoverBackground transition-colors text-vscode-descriptionForeground hover:text-vscode-foreground"
              title="Add to message"
            >
              <Plus className="w-4 h-4" />
            </button>

            {/* Mode dropdown trigger */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-vscode-toolbar-hoverBackground transition-colors"
              >
                <CurrentIcon className="w-3 h-3" />
                <span className="hidden min-[200px]:inline">{currentConfig.label}</span>
                <ChevronDown className={cn('w-2.5 h-2.5 transition-transform', dropdownOpen && 'rotate-180')} />
              </button>

              {/* Dropdown menu */}
              {dropdownOpen && (
                <div className="absolute bottom-full left-0 mb-1.5 w-56 rounded-lg border border-vscode-panel-border bg-vscode-editorWidget-background shadow-lg overflow-hidden z-50">
                  {(Object.keys(MODE_CONFIG) as ChatMode[]).map((m) => {
                    const config = MODE_CONFIG[m]
                    const Icon = config.icon
                    const isActive = mode === m

                    return (
                      <button
                        key={m}
                        onClick={() => {
                          setMode(m)
                          setDropdownOpen(false)
                        }}
                        className={cn(
                          'w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors',
                          'hover:bg-vscode-list-hoverBackground',
                          isActive && 'bg-vscode-list-hoverBackground'
                        )}
                      >
                        <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-vscode-descriptionForeground" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-vscode-foreground">
                              {config.label}
                            </span>
                            {isActive && (
                              <Check className="w-3.5 h-3.5 text-vscode-textLink-foreground" />
                            )}
                          </div>
                          <p className="text-[11px] text-vscode-descriptionForeground mt-0.5">
                            {config.description}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Send / Stop button */}
          {isLoading ? (
            <button
              onClick={onStop}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors bg-vscode-foreground text-vscode-editor-background"
              title="Stop generating"
            >
              <Square className="w-3 h-3" fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!value.trim()}
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-lg transition-colors',
                value.trim()
                  ? 'bg-vscode-foreground text-vscode-editor-background'
                  : 'bg-vscode-descriptionForeground/20 text-vscode-descriptionForeground/50'
              )}
              title="Send message"
            >
              <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
