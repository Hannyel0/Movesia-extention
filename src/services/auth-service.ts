/**
 * Auth Service — OAuth 2.1 PKCE client for the Movesia extension.
 *
 * Handles the full authorization code flow with PKCE (S256):
 *   1. Generates code_verifier + code_challenge
 *   2. Spins up a temporary localhost HTTP server to receive the callback
 *   3. Opens the browser to the authorization endpoint
 *   4. Receives the authorization code via the localhost server
 *   5. Exchanges the code for tokens
 *   6. Stores tokens securely in VS Code SecretStorage
 *   7. Refreshes tokens when they expire
 *   8. Exposes user info parsed from the id_token
 *
 * This approach is fully IDE-agnostic — no custom URI schemes (vscode://,
 * windsurf://, cursor://) are needed. Works on any VS Code fork.
 */

import * as vscode from 'vscode'
import * as http from 'http'
import { randomBytes, createHash } from 'crypto'

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

/** Base URL of the Movesia website (authorization server) */
const AUTH_SERVER_URL =
  process.env.MOVESIA_AUTH_URL || 'http://localhost:3000'

/** OAuth client ID registered on the website (public client) */
const CLIENT_ID =
  process.env.MOVESIA_OAUTH_CLIENT_ID || 'movesia-vscode-b66e5c16'

/**
 * Redirect URI — points to the intermediate callback page on the website.
 * The website page receives the authorization code via HTTP, then redirects
 * to the extension's temporary localhost server (port encoded in state param).
 * This works around Better Auth's strict exact-match redirect URI validation.
 */
const REDIRECT_URI = `${AUTH_SERVER_URL}/auth/callback`

/** Scopes to request */
const SCOPES = 'openid profile email offline_access'

/** How many seconds before expiry to trigger a refresh (5 minutes) */
const REFRESH_BUFFER_SECONDS = 5 * 60

/** How long to wait for the callback before timing out (5 minutes) */
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

// SecretStorage keys
const SECRET_KEY_ACCESS_TOKEN = 'movesia.oauth.accessToken'
const SECRET_KEY_REFRESH_TOKEN = 'movesia.oauth.refreshToken'
const SECRET_KEY_ID_TOKEN = 'movesia.oauth.idToken'
const SECRET_KEY_EXPIRES_AT = 'movesia.oauth.expiresAt'

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface AuthUser {
  sub: string
  name?: string
  email?: string
  picture?: string
}

export interface AuthState {
  isAuthenticated: boolean
  user: AuthUser | null
  /** ISO timestamp when the access token expires */
  expiresAt: string | null
}

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  id_token?: string
}

/** Result from the temporary callback server */
interface CallbackResult {
  code: string
  state: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// PKCE Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Generate a cryptographically random code verifier (43–128 chars, base64url) */
function generateCodeVerifier(): string {
  // 32 random bytes → 43 base64url characters
  return randomBytes(32)
    .toString('base64url')
}

/** Compute S256 code challenge from verifier */
function generateCodeChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier)
    .digest('base64url')
}

/**
 * Generate a state parameter that bundles CSRF protection with the callback port.
 * The state is base64url-encoded JSON so the intermediate callback page can
 * extract the port and redirect to the extension's temporary localhost server.
 */
function generateState(port: number): string {
  const csrf = randomBytes(16).toString('base64url')
  const statePayload = JSON.stringify({ csrf, port })
  return Buffer.from(statePayload).toString('base64url')
}

/** Decode a JWT payload without verification (we trust our own auth server) */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format')
  }
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8')
  return JSON.parse(payload)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTML Templates
// ═══════════════════════════════════════════════════════════════════════════════

/** Success page shown after the extension receives the authorization code */
function successHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign-in Successful — Movesia</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fff;
      color: #111;
    }
    .container { text-align: center; max-width: 360px; padding: 24px; }
    .icon {
      width: 48px; height: 48px; margin: 0 auto 16px;
      background: #f0fdf4; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
    }
    .icon svg { width: 24px; height: 24px; color: #16a34a; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    p { font-size: 14px; color: #6b7280; }
    .hint { margin-top: 24px; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </div>
    <h1>Sign-in Successful</h1>
    <p>You've been signed in to Movesia. You can close this tab and return to your editor.</p>
    <p class="hint">This tab will close automatically...</p>
  </div>
  <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`
}

/** Error page shown when the callback has a problem */
function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign-in Failed — Movesia</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fff;
      color: #111;
    }
    .container { text-align: center; max-width: 360px; padding: 24px; }
    .icon {
      width: 48px; height: 48px; margin: 0 auto 16px;
      background: #fef2f2; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
    }
    .icon svg { width: 24px; height: 24px; color: #dc2626; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    p { font-size: 14px; color: #6b7280; }
    .hint { margin-top: 24px; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
    <h1>Sign-in Failed</h1>
    <p>${message}</p>
    <p class="hint">You can close this tab and try again from your editor.</p>
  </div>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auth Service
// ═══════════════════════════════════════════════════════════════════════════════

export class AuthService {
  private secrets: vscode.SecretStorage
  private callbackServer: http.Server | null = null
  private cachedUser: AuthUser | null = null
  private outputChannel: vscode.OutputChannel | null = null

  /** Fired whenever auth state changes (sign in, sign out, token refresh) */
  private _onAuthStateChanged = new vscode.EventEmitter<AuthState>()
  readonly onAuthStateChanged = this._onAuthStateChanged.event

  constructor(
    context: vscode.ExtensionContext,
    outputChannel?: vscode.OutputChannel
  ) {
    this.secrets = context.secrets
    this.outputChannel = outputChannel ?? null
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Logging
  // ─────────────────────────────────────────────────────────────────────────

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const timestamp = new Date().toISOString().slice(11, 19)
    const formatted = `[${timestamp}] [Auth] ${message}`

    if (level === 'error') {
      console.error(formatted)
    } else if (level === 'warn') {
      console.warn(formatted)
    } else {
      console.log(formatted)
    }

    this.outputChannel?.appendLine(formatted)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start the sign-in flow.
   * 1. Spins up a temporary HTTP server on 127.0.0.1 (random port)
   * 2. Opens the browser to the authorization page
   * 3. Waits for the callback on the localhost server
   * 4. Exchanges the code for tokens
   * 5. Returns the authenticated state
   */
  async signIn(): Promise<AuthState> {
    const signInId = randomBytes(4).toString('hex')
    this.log(`[signIn:${signInId}] Starting sign-in flow`)

    // Shut down any leftover server from a previous attempt
    if (this.callbackServer) {
      this.log(`[signIn:${signInId}] Shutting down leftover server...`)
      await this.shutdownCallbackServer()
    }

    // Generate PKCE pair
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)

    // Start temporary callback server (OS assigns a random available port)
    const { port, waitForCallback, shutdown } = await this.startCallbackServer()
    this.log(`[signIn:${signInId}] Callback server listening on port ${port}`)

    // Generate state with the callback port encoded
    const state = generateState(port)

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: SCOPES,
      state,
    })

    const authUrl = `${AUTH_SERVER_URL}/api/auth/oauth2/authorize?${params.toString()}`

    // Open the browser
    const authUri = vscode.Uri.parse(authUrl)
    this.log(`[signIn:${signInId}] Opening browser...`)
    const opened = await vscode.env.openExternal(authUri)
    if (!opened) {
      this.log(`[signIn:${signInId}] Failed to open browser!`, 'error')
      await shutdown()
      throw new Error('Failed to open browser for sign-in')
    }

    this.log(`[signIn:${signInId}] Browser opened — waiting for callback...`)

    try {
      // Wait for the callback (with 5-minute timeout)
      const result = await waitForCallback
      this.log(`[signIn:${signInId}] Callback received`)

      // Validate state to prevent CSRF
      if (result.state !== state) {
        throw new Error('State mismatch — possible CSRF attack. Please try again.')
      }

      // Exchange code for tokens
      const tokenResponse = await this.exchangeCodeForTokens(result.code, codeVerifier)
      await this.storeTokens(tokenResponse)
      await this.loadUserFromIdToken()

      const authState = this.buildAuthState(true)
      this._onAuthStateChanged.fire(authState)

      this.log(`[signIn:${signInId}] ✓ Sign-in complete — ${authState.user?.email || authState.user?.name || 'unknown'}`)
      return authState
    } catch (err) {
      this.log(`[signIn:${signInId}] ERROR: ${(err as Error).message}`, 'error')
      throw err
    } finally {
      await shutdown()
    }
  }

  /**
   * Sign out — clear all stored tokens and notify listeners.
   */
  async signOut(): Promise<void> {
    this.log('Signing out...')

    await Promise.all([
      this.secrets.delete(SECRET_KEY_ACCESS_TOKEN),
      this.secrets.delete(SECRET_KEY_REFRESH_TOKEN),
      this.secrets.delete(SECRET_KEY_ID_TOKEN),
      this.secrets.delete(SECRET_KEY_EXPIRES_AT),
    ])

    this.cachedUser = null

    const state = this.buildAuthState(false)
    this._onAuthStateChanged.fire(state)

    this.log('Signed out — tokens cleared')
  }

  /**
   * Get the current authentication state.
   * Checks if we have valid (or refreshable) tokens in storage.
   */
  async getAuthState(): Promise<AuthState> {
    const accessToken = await this.secrets.get(SECRET_KEY_ACCESS_TOKEN)
    if (!accessToken) {
      return this.buildAuthState(false)
    }

    // Check expiry
    const expiresAtStr = await this.secrets.get(SECRET_KEY_EXPIRES_AT)
    const expiresAt = expiresAtStr ? new Date(expiresAtStr) : null

    if (expiresAt && expiresAt.getTime() < Date.now()) {
      this.log('Access token expired, attempting refresh...')
      try {
        return await this.refreshAccessToken()
      } catch (err) {
        this.log(`Refresh failed: ${(err as Error).message}`, 'warn')
        await this.signOut()
        return this.buildAuthState(false)
      }
    }

    if (!this.cachedUser) {
      await this.loadUserFromIdToken()
    }

    return this.buildAuthState(true)
  }

  /**
   * Get a valid access token, refreshing if necessary.
   * Returns null if not authenticated.
   */
  async getAccessToken(): Promise<string | null> {
    const accessToken = await this.secrets.get(SECRET_KEY_ACCESS_TOKEN)
    if (!accessToken) {
      return null
    }

    // Check if token is expired or about to expire
    const expiresAtStr = await this.secrets.get(SECRET_KEY_EXPIRES_AT)
    const expiresAt = expiresAtStr ? new Date(expiresAtStr) : null
    const bufferMs = REFRESH_BUFFER_SECONDS * 1000

    if (expiresAt && expiresAt.getTime() - bufferMs < Date.now()) {
      this.log('Access token expiring soon, refreshing...')
      try {
        await this.refreshAccessToken()
        return await this.secrets.get(SECRET_KEY_ACCESS_TOKEN) ?? null
      } catch {
        return null
      }
    }

    return accessToken
  }

  /**
   * Check if the user is currently authenticated.
   */
  async isAuthenticated(): Promise<boolean> {
    const state = await this.getAuthState()
    return state.isAuthenticated
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Initialize — restore cached user on activation
  // ─────────────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.log('Initializing auth service...')
    await this.loadUserFromIdToken()

    const state = await this.getAuthState()
    if (state.isAuthenticated) {
      this.log(`Restored session for user: ${state.user?.email || state.user?.name || 'unknown'}`)
    } else {
      this.log('No active session found')
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal — Localhost Callback Server
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start a temporary HTTP server on 127.0.0.1 with an OS-assigned random port.
   * Returns the port, a promise that resolves when the callback arrives, and
   * a shutdown function.
   */
  private startCallbackServer(): Promise<{
    port: number
    waitForCallback: Promise<CallbackResult>
    shutdown: () => Promise<void>
  }> {
    return new Promise((resolveStart, rejectStart) => {
      let callbackResolve: (result: CallbackResult) => void
      let callbackReject: (err: Error) => void

      const waitForCallback = new Promise<CallbackResult>((res, rej) => {
        callbackResolve = res
        callbackReject = rej
      })

      // Track all open sockets so we can force-destroy them on shutdown.
      // Without this, server.close() waits for keep-alive connections to
      // drain (~3-4 minutes), blocking the entire signIn() call.
      const openSockets = new Set<import('net').Socket>()

      // Timeout: reject if no callback arrives within 5 minutes
      const timeout = setTimeout(() => {
        this.log('[callbackServer] Timed out after 5 minutes waiting for callback', 'warn')
        callbackReject(new Error('Sign-in timed out. Please try again.'))
        shutdown()
      }, CALLBACK_TIMEOUT_MS)

      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://127.0.0.1`)

        // Only handle GET /callback
        if (req.method !== 'GET' || url.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not found')
          return
        }

        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')
        const errorDescription = url.searchParams.get('error_description')

        // Handle authorization server errors
        if (error) {
          const message = errorDescription || error || 'An unknown error occurred.'
          this.log(`[callbackServer] Authorization error: ${error} — ${message}`, 'error')
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(errorHtml(message))
          callbackReject(new Error(`Authorization error: ${error} — ${message}`))
          return
        }

        if (!code || !state) {
          this.log('[callbackServer] Missing code or state in callback!', 'error')
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(errorHtml('Missing authorization code or state.'))
          callbackReject(new Error('Missing code or state in callback'))
          return
        }

        // Success — respond with success page and resolve the promise
        this.log(`[callbackServer] Authorization code received`)
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Connection': 'close',  // Tell browser not to keep-alive
        })
        res.end(successHtml())
        clearTimeout(timeout)
        callbackResolve({ code, state })
      })

      // Track sockets as they connect / disconnect
      server.on('connection', (socket) => {
        openSockets.add(socket)
        socket.once('close', () => openSockets.delete(socket))
      })

      // Shutdown helper — force-destroys all open sockets so server.close()
      // resolves immediately instead of waiting for keep-alive timeout.
      const shutdown = async (): Promise<void> => {
        clearTimeout(timeout)
        return new Promise<void>((resolveShutdown) => {
          if (!server.listening) {
            this.callbackServer = null
            resolveShutdown()
            return
          }
          // Force-destroy all open connections
          for (const socket of openSockets) {
            socket.destroy()
          }
          openSockets.clear()
          server.close(() => {
            this.callbackServer = null
            resolveShutdown()
          })
        })
      }

      // Handle server errors
      server.on('error', (err) => {
        this.log(`[callbackServer] Server error: ${err.message}`, 'error')
        clearTimeout(timeout)
        rejectStart(err)
      })

      // Listen on 127.0.0.1 with port 0 (OS assigns random available port)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (!addr || typeof addr === 'string') {
          rejectStart(new Error('Failed to get callback server address'))
          return
        }
        this.callbackServer = server
        resolveStart({
          port: addr.port,
          waitForCallback,
          shutdown,
        })
      })
    })
  }

  /**
   * Shut down any existing callback server, force-destroying open connections.
   */
  private async shutdownCallbackServer(): Promise<void> {
    if (!this.callbackServer) {
      return
    }
    this.log('[shutdownCallbackServer] Closing existing callback server...')
    const server = this.callbackServer
    return new Promise<void>((resolve) => {
      // Force-destroy all open connections so close() resolves immediately
      if (typeof (server as any).closeAllConnections === 'function') {
        // Node 18.2+ has this built-in
        ;(server as any).closeAllConnections()
      }
      server.close(() => {
        this.log('[shutdownCallbackServer] Server closed')
        this.callbackServer = null
        resolve()
      })
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal — Token Exchange
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST to the token endpoint to exchange an authorization code for tokens.
   */
  private async exchangeCodeForTokens(
    code: string,
    codeVerifier: string
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    })

    const response = await fetch(`${AUTH_SERVER_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      this.log(`[tokenExchange] Failed: ${response.status} — ${errorText}`, 'error')
      throw new Error(`Token exchange failed: ${response.status} — ${errorText}`)
    }

    return (await response.json()) as TokenResponse
  }

  /**
   * Use the refresh token to get a new access token.
   */
  private async refreshAccessToken(): Promise<AuthState> {
    const refreshToken = await this.secrets.get(SECRET_KEY_REFRESH_TOKEN)
    if (!refreshToken) {
      throw new Error('No refresh token available')
    }

    this.log('Refreshing access token...')

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    })

    const response = await fetch(`${AUTH_SERVER_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      this.log(`Token refresh failed (${response.status}): ${errorText}`, 'error')
      throw new Error(`Token refresh failed: ${response.status}`)
    }

    const data = (await response.json()) as TokenResponse

    // Store new tokens (refresh token may be rotated)
    await this.storeTokens(data)

    // Update cached user if id_token was returned
    if (data.id_token) {
      await this.loadUserFromIdToken()
    }

    const authState = this.buildAuthState(true)
    this._onAuthStateChanged.fire(authState)

    this.log('Access token refreshed successfully')

    return authState
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal — Storage
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Store tokens securely in VS Code's SecretStorage.
   */
  private async storeTokens(tokens: TokenResponse): Promise<void> {
    await this.secrets.store(SECRET_KEY_ACCESS_TOKEN, tokens.access_token)

    if (tokens.refresh_token) {
      await this.secrets.store(SECRET_KEY_REFRESH_TOKEN, tokens.refresh_token)
    }
    if (tokens.id_token) {
      await this.secrets.store(SECRET_KEY_ID_TOKEN, tokens.id_token)
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
    await this.secrets.store(SECRET_KEY_EXPIRES_AT, expiresAt.toISOString())
  }

  /**
   * Parse user info from the stored id_token.
   */
  private async loadUserFromIdToken(): Promise<void> {
    const idToken = await this.secrets.get(SECRET_KEY_ID_TOKEN)
    if (!idToken) {
      this.cachedUser = null
      return
    }

    try {
      const payload = decodeJwtPayload(idToken)
      this.cachedUser = {
        sub: payload.sub as string,
        name: payload.name as string | undefined,
        email: payload.email as string | undefined,
        picture: payload.picture as string | undefined,
      }
    } catch (err) {
      this.log(`Failed to decode id_token: ${(err as Error).message}`, 'warn')
      this.cachedUser = null
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal — Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private buildAuthState(isAuthenticated: boolean): AuthState {
    return {
      isAuthenticated,
      user: isAuthenticated ? this.cachedUser : null,
      expiresAt: isAuthenticated
        ? null // will be read from storage when needed
        : null,
    }
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    this._onAuthStateChanged.dispose()
    this.shutdownCallbackServer()
  }
}
