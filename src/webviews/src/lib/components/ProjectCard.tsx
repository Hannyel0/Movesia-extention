import React from 'react'
import { Loader2, ChevronRight } from 'lucide-react'
import { cn } from '../utils'
import type { UnityProjectInfo } from '../types/project'

interface ProjectCardProps {
  project: UnityProjectInfo
  onClick: () => void
  isLoading?: boolean
  disabled?: boolean
  unityRunning?: boolean
}

export function ProjectCard({ project, onClick, isLoading, disabled, unityRunning }: ProjectCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={cn(
        'w-full text-left px-3.5 py-3 rounded-md transition-colors group',
        'hover:bg-vscode-list-hoverBackground',
        'focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
    >
      <div className="flex items-center gap-3">
        {/* Status indicator dot — Unity open/closed */}
        <div className="flex-shrink-0 relative">
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-vscode-textLink-foreground" />
          ) : unityRunning ? (
            <div className="relative flex items-center justify-center w-3 h-3">
              <div className="absolute w-2.5 h-2.5 rounded-full bg-vscode-testing-iconPassed/30 animate-[pulse-dot_2s_ease-in-out_infinite]" />
              <div className="w-2 h-2 rounded-full bg-vscode-testing-iconPassed" />
            </div>
          ) : (
            <div className="w-2 h-2 rounded-full bg-vscode-descriptionForeground/40" />
          )}
        </div>

        {/* Project info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-vscode-foreground truncate">
              {project.name}
            </span>
            {project.editorVersion && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-px rounded bg-vscode-badge-background text-vscode-badge-foreground">
                {project.editorVersion}
              </span>
            )}
          </div>
          <p className="text-[11px] text-vscode-descriptionForeground truncate mt-0.5">
            {project.path}
          </p>
        </div>

        {/* Arrow */}
        <ChevronRight className="w-3.5 h-3.5 text-vscode-descriptionForeground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      </div>
    </button>
  )
}
