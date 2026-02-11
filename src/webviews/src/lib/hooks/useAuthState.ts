import { useState, useEffect, useCallback } from 'react'
import VSCodeAPI from '../VSCodeAPI'

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrors AuthState from auth-service.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthUser {
  sub: string
  name?: string
  email?: string
  picture?: string
}

export interface AuthState {
  isAuthenticated: boolean
  user: AuthUser | null
  expiresAt: string | null
}

interface UseAuthStateReturn {
  /** Current auth state */
  authState: AuthState
  /** Whether the initial auth check is still loading */
  isLoading: boolean
  /** Last auth error message, if any */
  error: string | null
  /** Trigger the sign-in flow (opens browser) */
  signIn: () => void
  /** Trigger sign-out (clears tokens) */
  signOut: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook to communicate with the extension host's AuthService.
 *
 * - On mount, sends `getAuthState` to check if user is already signed in.
 * - Listens for `authStateChanged` messages (from sign-in, sign-out, or token refresh).
 * - Listens for `authError` messages (from failed sign-in attempts).
 * - Provides `signIn()` and `signOut()` actions.
 */
export function useAuthState(): UseAuthStateReturn {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    expiresAt: null,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Listen for auth messages from the extension host
  useEffect(() => {
    console.log('[OAuth][useAuthState] Setting up message listener')

    const handleMessage = (event: MessageEvent) => {
      const message = event.data

      if (message.type === 'authStateChanged') {
        console.log('[OAuth][useAuthState] Received authStateChanged:', JSON.stringify(message.state))
        console.log(`[OAuth][useAuthState] isAuthenticated: ${message.state.isAuthenticated}`)
        console.log(`[OAuth][useAuthState] user: ${message.state.user ? message.state.user.email || message.state.user.name : 'null'}`)
        setAuthState(message.state)
        setIsLoading(false)
        setError(null) // Clear any previous error on state change
      }

      if (message.type === 'authError') {
        console.error('[OAuth][useAuthState] Received authError:', message.error)
        setError(message.error)
        setIsLoading(false)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      console.log('[OAuth][useAuthState] Cleaning up message listener')
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  // Fetch current auth state on mount
  useEffect(() => {
    console.log('[OAuth][useAuthState] Sending getAuthState to extension host')
    VSCodeAPI.postMessage({ type: 'getAuthState' })
  }, [])

  const signIn = useCallback(() => {
    console.log('[OAuth][useAuthState] signIn() called — sending signIn message to extension host')
    setError(null)
    VSCodeAPI.postMessage({ type: 'signIn' })
  }, [])

  const signOut = useCallback(() => {
    console.log('[OAuth][useAuthState] signOut() called — sending signOut message to extension host')
    setError(null)
    VSCodeAPI.postMessage({ type: 'signOut' })
  }, [])

  return {
    authState,
    isLoading,
    error,
    signIn,
    signOut,
  }
}
