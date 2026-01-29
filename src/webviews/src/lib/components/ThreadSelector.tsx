import React, { useState, useMemo } from 'react'
import { ChevronDown, Plus, MessageSquare, Search, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { cn } from '../utils'

export interface Thread {
  id: string
  title: string
  createdAt: Date
  messageCount: number
}

interface ThreadSelectorProps {
  threads: Thread[]
  currentThreadId: string | null
  onSelectThread: (threadId: string) => void
  onNewThread: () => void
  onDeleteThread: (threadId: string) => void
}

export function ThreadSelector({
  threads,
  currentThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
}: ThreadSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const currentThread = threads.find(t => t.id === currentThreadId)

  // Filter threads based on search
  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads
    const query = searchQuery.toLowerCase()
    return threads.filter(t => t.title.toLowerCase().includes(query))
  }, [threads, searchQuery])

  // Format relative time
  const formatRelativeTime = (date: Date) => {
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m`
    if (diffHours < 24) return `${diffHours}h`
    if (diffDays < 7) return `${diffDays}d`
    return date.toLocaleDateString()
  }

  // Group threads by time period
  const groupedThreads = useMemo(() => {
    const today: Thread[] = []
    const yesterday: Thread[] = []
    const older: Thread[] = []

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterdayStart = new Date(todayStart.getTime() - 86400000)

    filteredThreads.forEach(thread => {
      if (thread.createdAt >= todayStart) {
        today.push(thread)
      } else if (thread.createdAt >= yesterdayStart) {
        yesterday.push(thread)
      } else {
        older.push(thread)
      }
    })

    return { today, yesterday, older }
  }, [filteredThreads])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'h-7 px-2 gap-1.5 font-normal text-xs',
            'hover:bg-accent/50 transition-colors',
            'focus-visible:ring-1 focus-visible:ring-ring'
          )}
        >
          <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="truncate max-w-[160px] text-foreground">
            {currentThread?.title || 'New Chat'}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        {/* Search Input */}
        <div className="px-2 py-1.5">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 border border-border/50">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              onClick={e => e.stopPropagation()}
            />
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Thread List */}
        <div className="max-h-[320px] overflow-y-auto">
          {/* Today */}
          {groupedThreads.today.length > 0 && (
            <>
              <div className="px-2 py-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Today
                </span>
              </div>
              {groupedThreads.today.map(thread => (
                <ThreadItem
                  key={thread.id}
                  thread={thread}
                  isActive={thread.id === currentThreadId}
                  onSelect={() => onSelectThread(thread.id)}
                  onDelete={() => onDeleteThread(thread.id)}
                  formatTime={formatRelativeTime}
                />
              ))}
            </>
          )}

          {/* Yesterday */}
          {groupedThreads.yesterday.length > 0 && (
            <>
              <div className="px-2 py-1 mt-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Yesterday
                </span>
              </div>
              {groupedThreads.yesterday.map(thread => (
                <ThreadItem
                  key={thread.id}
                  thread={thread}
                  isActive={thread.id === currentThreadId}
                  onSelect={() => onSelectThread(thread.id)}
                  onDelete={() => onDeleteThread(thread.id)}
                  formatTime={formatRelativeTime}
                />
              ))}
            </>
          )}

          {/* Older */}
          {groupedThreads.older.length > 0 && (
            <>
              <div className="px-2 py-1 mt-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Older
                </span>
              </div>
              {groupedThreads.older.map(thread => (
                <ThreadItem
                  key={thread.id}
                  thread={thread}
                  isActive={thread.id === currentThreadId}
                  onSelect={() => onSelectThread(thread.id)}
                  onDelete={() => onDeleteThread(thread.id)}
                  formatTime={formatRelativeTime}
                />
              ))}
            </>
          )}

          {/* Empty state */}
          {filteredThreads.length === 0 && (
            <div className="px-2 py-6 text-center">
              <p className="text-xs text-muted-foreground">
                {searchQuery ? 'No matching sessions' : 'No previous sessions'}
              </p>
            </div>
          )}
        </div>

        <DropdownMenuSeparator />

        {/* New Thread Button */}
        <DropdownMenuItem
          onClick={onNewThread}
          className="gap-2 cursor-pointer mx-1 mb-1 focus:bg-primary/10"
        >
          <Plus className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium">New Chat</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface ThreadItemProps {
  thread: Thread
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  formatTime: (date: Date) => string
}

function ThreadItem({ thread, isActive, onSelect, onDelete, formatTime }: ThreadItemProps) {
  return (
    <DropdownMenuItem
      onClick={onSelect}
      className={cn(
        'gap-2 cursor-pointer group mx-1 rounded-md',
        isActive && 'bg-accent/50'
      )}
    >
      <span className="flex-1 text-xs truncate">{thread.title}</span>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {formatTime(thread.createdAt)}
      </span>
      <button
        onClick={e => {
          e.stopPropagation()
          onDelete()
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-destructive/10 rounded transition-opacity"
        title="Delete thread"
      >
        <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
      </button>
    </DropdownMenuItem>
  )
}
