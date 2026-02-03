import React from 'react'
import { Folder, Check, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '../utils'
import type { UnityProjectInfo } from '../types/project'

interface ProjectCardProps {
  project: UnityProjectInfo
  onClick: () => void
  isLoading?: boolean
  disabled?: boolean
}

export function ProjectCard({ project, onClick, isLoading, disabled }: ProjectCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={cn(
        'w-full text-left p-4 rounded-lg border transition-colors',
        'bg-vscode-editor-background border-vscode-panel-border',
        'hover:bg-vscode-list-hoverBackground hover:border-vscode-focusBorder',
        'focus:outline-none focus:ring-2 focus:ring-vscode-focusBorder',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Folder className="w-5 h-5 text-vscode-textLink-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-vscode-foreground truncate">{project.name}</h3>
            {project.editorVersion && (
              <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded bg-vscode-badge-background text-vscode-badge-foreground">
                Unity {project.editorVersion}
              </span>
            )}
          </div>
          <p className="text-xs text-vscode-descriptionForeground mt-1 truncate">{project.path}</p>
          <div className="flex items-center gap-1.5 mt-2">
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-vscode-textLink-foreground" />
                <span className="text-xs text-vscode-descriptionForeground">Checking...</span>
              </>
            ) : project.movesiaInstalled ? (
              <>
                <Check className="w-3.5 h-3.5 text-vscode-testing-iconPassed" />
                <span className="text-xs text-vscode-testing-iconPassed">
                  Movesia installed{project.movesiaVersion ? ` (v${project.movesiaVersion})` : ''}
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-vscode-editorWarning-foreground" />
                <span className="text-xs text-vscode-editorWarning-foreground">
                  Movesia not installed
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
