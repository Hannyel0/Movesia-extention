import React from 'react'
import { createRoot } from 'react-dom/client'
import ChatView from './ChatView'
import View2 from './View2'
import ProjectSelector from './ProjectSelector'
import InstallPackage from './InstallPackage'
import SignIn from './SignIn'
import SettingsView from './SettingsView'
import './lib/vscode.css'
import { MemoryRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useAuthState } from './lib/hooks/useAuthState'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'

const rootEl = document.getElementById('root')

// Get the initial route from data attribute, ensure it has leading slash
const getInitialRoute = () => {
  const route = rootEl?.dataset.route || 'signIn'
  const resolved = route.startsWith('/') ? route : `/${route}`
  console.log(`[OAuth][Router] Initial route resolved: "${resolved}" (from data-route="${route}")`)
  return resolved
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth-gated wrapper — redirects unauthenticated users to /signIn
// and authenticated users away from /signIn to /projectSelector.
// ─────────────────────────────────────────────────────────────────────────────

function AuthGate({ children }: { children: React.ReactNode }) {
  const { authState, isLoading } = useAuthState()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    console.log(`[OAuth][AuthGate] Effect: isLoading=${isLoading}, isAuthenticated=${authState.isAuthenticated}, currentPath=${location.pathname}`)

    if (isLoading) {
      console.log('[OAuth][AuthGate] Still loading — skipping')
      return
    }

    if (authState.isAuthenticated && location.pathname === '/signIn') {
      console.log(`[OAuth][AuthGate] User is authenticated on /signIn — redirecting to /projectSelector`)
      navigate('/projectSelector', { replace: true })
    } else if (!authState.isAuthenticated && location.pathname !== '/signIn') {
      console.log(`[OAuth][AuthGate] User is NOT authenticated — redirecting from ${location.pathname} to /signIn`)
      navigate('/signIn', { replace: true })
    }
  }, [authState.isAuthenticated, isLoading, navigate, location.pathname])

  return <>{children}</>
}

/**
 * Wraps a route element so it is only accessible when authenticated.
 * If the user is not authenticated, they are redirected to /signIn.
 * While loading, a spinner is shown.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { authState, isLoading } = useAuthState()
  const location = useLocation()

  console.log(`[OAuth][RequireAuth] path=${location.pathname}, isLoading=${isLoading}, isAuthenticated=${authState.isAuthenticated}`)

  if (isLoading) {
    console.log('[OAuth][RequireAuth] Still loading — showing spinner')
    return (
      <div className="flex flex-col h-screen bg-vscode-editor-background text-vscode-foreground items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-vscode-descriptionForeground mb-3" />
        <p className="text-sm text-vscode-descriptionForeground">Loading…</p>
      </div>
    )
  }

  if (!authState.isAuthenticated) {
    console.log(`[OAuth][RequireAuth] Not authenticated — redirecting from ${location.pathname} to /signIn`)
    return <Navigate to="/signIn" replace />
  }

  console.log(`[OAuth][RequireAuth] Authenticated — rendering protected route ${location.pathname}`)
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public route */}
      <Route path="/signIn" element={<SignIn />} />

      {/* Protected routes */}
      <Route
        path="/projectSelector"
        element={
          <RequireAuth>
            <ProjectSelector />
          </RequireAuth>
        }
      />
      <Route
        path="/installPackage"
        element={
          <RequireAuth>
            <InstallPackage />
          </RequireAuth>
        }
      />
      <Route
        path="/chatView"
        element={
          <RequireAuth>
            <ChatView />
          </RequireAuth>
        }
      />
      <Route
        path="/view2"
        element={
          <RequireAuth>
            <View2 />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsView />
          </RequireAuth>
        }
      />
    </Routes>
  )
}

const reactRoot = createRoot(rootEl!)
reactRoot.render(
  <React.StrictMode>
    <Router initialEntries={[getInitialRoute()]} initialIndex={0}>
      <AuthGate>
        <AppRoutes />
      </AuthGate>
    </Router>
  </React.StrictMode>
)
