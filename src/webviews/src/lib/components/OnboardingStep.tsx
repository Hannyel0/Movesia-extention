import React from 'react'
import { Check, Loader2 } from 'lucide-react'
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
  /** Whether this is the last step (no connector line) */
  isLast?: boolean
}

// Minimal status dot
function StatusDot({ status }: { status: StepStatus }) {
  switch (status) {
    case 'completed':
      return (
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-vscode-testing-iconPassed/15">
          <Check className="w-3 h-3 text-vscode-testing-iconPassed" />
        </div>
      )
    case 'loading':
      return (
        <div className="flex items-center justify-center w-5 h-5">
          <Loader2 className="w-3.5 h-3.5 text-vscode-textLink-foreground animate-spin" />
        </div>
      )
    case 'active':
      return (
        <div className="flex items-center justify-center w-5 h-5">
          <div className="w-2 h-2 rounded-full bg-vscode-textLink-foreground" />
        </div>
      )
    case 'pending':
    default:
      return (
        <div className="flex items-center justify-center w-5 h-5">
          <div className="w-2 h-2 rounded-full bg-vscode-descriptionForeground/30" />
        </div>
      )
  }
}

/**
 * A single step in the onboarding flow.
 * Displays a status dot, vertical connector, title, description, and optional action.
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
    <div className="flex gap-3">
      {/* Left: dot + connector line */}
      <div className="flex flex-col items-center pt-0.5">
        <StatusDot status={status} />
        {!isLast && (
          <div
            className={cn(
              'w-px flex-1 mt-1.5',
              isCompleted ? 'bg-vscode-testing-iconPassed/25' : 'bg-vscode-panel-border'
            )}
          />
        )}
      </div>

      {/* Right: content */}
      <div className={cn('pb-6', isLast && 'pb-0')}>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-sm font-medium',
              isCompleted && 'text-vscode-testing-iconPassed',
              isActive && 'text-vscode-foreground',
              isPending && 'text-vscode-descriptionForeground/60'
            )}
          >
            {title}
          </span>
          {badge && (
            <span
              className={cn(
                'text-[10px] px-1.5 py-px rounded',
                isCompleted
                  ? 'bg-vscode-testing-iconPassed/10 text-vscode-testing-iconPassed'
                  : 'bg-vscode-badge-background text-vscode-badge-foreground'
              )}
            >
              {badge}
            </span>
          )}
        </div>
        <p
          className={cn(
            'text-xs mt-0.5',
            isPending ? 'text-vscode-descriptionForeground/40' : 'text-vscode-descriptionForeground'
          )}
        >
          {description}
        </p>

        {/* Action button */}
        {action && isActive && (
          <Button
            variant="outline"
            size="sm"
            onClick={action.onClick}
            disabled={action.disabled}
            className="mt-2 h-7 text-xs"
          >
            {action.label}
          </Button>
        )}
      </div>
    </div>
  )
}
