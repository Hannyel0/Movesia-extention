import React from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from './lib/components/ui/button'
import { useAuthState } from './lib/hooks/useAuthState'

function MovesiaLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="10" fill="currentColor" fillOpacity="0.1" />
      <path
        d="M12 28V14l8 7 8-7v14"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function SignIn() {
  const { isLoading, error, signIn } = useAuthState()

  console.log(`[OAuth][SignIn] Render: isLoading=${isLoading}, error=${error || 'null'}`)

  // While the hook checks initial auth state, show a loading spinner
  // (If the user turns out to be authenticated, the AuthGate in index.tsx
  //  will redirect them away from this screen automatically.)
  if (isLoading) {
    console.log('[OAuth][SignIn] Showing loading spinner')
    return (
      <div className="flex flex-col h-screen bg-vscode-editor-background text-vscode-foreground items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-vscode-descriptionForeground mb-3" />
        <p className="text-sm text-vscode-descriptionForeground">Checking sign-in status…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-vscode-editor-background text-vscode-foreground">
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-xs text-center">
          {/* Brand */}
          <div className="flex flex-col items-center mb-10">
            <MovesiaLogo className="w-14 h-14 text-vscode-textLink-foreground mb-5" />
            <h1 className="text-xl font-semibold tracking-tight">Movesia AI</h1>
            <p className="text-sm text-vscode-descriptionForeground mt-1.5">
              AI-powered Unity development
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-4 px-3 py-2 rounded-md bg-[var(--vscode-inputValidation-errorBackground,rgba(255,0,0,0.1))] border border-[var(--vscode-inputValidation-errorBorder,#be1100)]">
              <p className="text-xs text-[var(--vscode-errorForeground,#f48771)]">{error}</p>
            </div>
          )}

          {/* Actions — both buttons trigger the OAuth flow (opens browser) */}
          <div className="space-y-3">
            <Button className="w-full" size="default" onClick={() => { console.log('[OAuth][SignIn] "Sign in" button clicked'); signIn() }}>
              Sign in
            </Button>
            <Button className="w-full" variant="outline" size="default" onClick={() => { console.log('[OAuth][SignIn] "Sign up" button clicked'); signIn() }}>
              Sign up
            </Button>
          </div>

          <p className="text-xs text-vscode-descriptionForeground mt-4">
            You'll be redirected to your browser to sign in or create an account.
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="flex-shrink-0 py-4 px-6">
        <p className="text-center text-xs text-vscode-descriptionForeground">
          By continuing, you agree to our{' '}
          <a
            href="https://movesia.ai/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-vscode-textLink-foreground hover:underline"
          >
            Terms
          </a>{' '}
          and{' '}
          <a
            href="https://movesia.ai/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-vscode-textLink-foreground hover:underline"
          >
            Privacy Policy
          </a>
        </p>
      </footer>
    </div>
  )
}

export default SignIn
