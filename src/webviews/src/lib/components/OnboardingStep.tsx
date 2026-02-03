import React from 'react'
import { Check, Circle, Loader2 } from 'lucide-react'
import { cn } from '../utils'
import { Button } from './ui/button'

export type StepStatus = 'pending' | 'active' | 'completed' | 'loading'

export interface OnboardingStepProps {
  /** Step icon component */
  icon: React.ReactNode
  /** Step title */
  title: string
  /** Step description */
  description: string
  /** Current status of this step */
  status: StepStatus
  /** Optional badge text (e.g., version number) */
  badge?: string
  /** Optional action button */
  action?: {
    label: string
    onClick: () => void
    disabled?: boolean
  }
  /** Whether this is the last step (no bottom border) */
  isLast?: boolean
}

// Status indicator component
function StatusIndicator({ status }: { status: StepStatus }) {
  switch (status) {
    case 'completed':
      return (
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-green-500/20">
          <Check className="w-3 h-3 text-green-500" />
        </div>
      )
    case 'active':
      return (
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-vscode-textLink-foreground/20">
          <Circle className="w-2.5 h-2.5 fill-vscode-textLink-foreground text-vscode-textLink-foreground" />
        </div>
      )
    case 'loading':
      return (
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-vscode-textLink-foreground/20">
          <Loader2 className="w-3 h-3 text-vscode-textLink-foreground animate-spin" />
        </div>
      )
    case 'pending':
    default:
      return (
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-vscode-descriptionForeground/20">
          <Circle className="w-2.5 h-2.5 text-vscode-descriptionForeground" />
        </div>
      )
  }
}

/**
 * A single step in the onboarding flow.
 * Displays an icon, title, description, status indicator, and optional action button.
 */
export function OnboardingStep({
  icon,
  title,
  description,
  status,
  badge,
  action,
  isLast = false,
}: OnboardingStepProps) {
  const isActive = status === 'active' || status === 'loading'
  const isCompleted = status === 'completed'
  const isPending = status === 'pending'

  return (
    <div
      className={cn(
        'flex items-start gap-4 p-4 rounded-lg transition-colors',
        !isLast && 'border-b border-vscode-panel-border',
        isActive && 'bg-vscode-list-hoverBackground'
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          'flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0',
          isCompleted && 'bg-green-500/10',
          isActive && 'bg-vscode-textLink-foreground/10',
          isPending && 'bg-vscode-descriptionForeground/10'
        )}
      >
        <div
          className={cn(
            'w-5 h-5',
            isCompleted && 'text-green-500',
            isActive && 'text-vscode-textLink-foreground',
            isPending && 'text-vscode-descriptionForeground'
          )}
        >
          {icon}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3
            className={cn(
              'font-medium',
              isCompleted && 'text-green-500',
              isActive && 'text-vscode-foreground',
              isPending && 'text-vscode-descriptionForeground'
            )}
          >
            {title}
          </h3>
          <StatusIndicator status={status} />
        </div>
        <p
          className={cn(
            'text-sm mt-0.5',
            isPending ? 'text-vscode-descriptionForeground/60' : 'text-vscode-descriptionForeground'
          )}
        >
          {description}
        </p>
        {badge && (
          <span
            className={cn(
              'inline-block text-xs px-2 py-0.5 rounded mt-2',
              isCompleted && 'bg-green-500/10 text-green-500',
              isActive && 'bg-vscode-badge-background text-vscode-badge-foreground',
              isPending && 'bg-vscode-descriptionForeground/10 text-vscode-descriptionForeground'
            )}
          >
            {badge}
          </span>
        )}
      </div>

      {/* Action button */}
      {action && isActive && (
        <Button
          variant="outline"
          size="sm"
          onClick={action.onClick}
          disabled={action.disabled}
          className="flex-shrink-0"
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}
