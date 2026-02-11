/**
 * Unity Manager for WebSocket connection management.
 *
 * Option B architecture: Accept ALL Unity connections, route commands
 * to the one matching the target project. Non-target connections stay
 * idle (heartbeats only). Switching target project is instant.
 *
 * Integrates:
 * - Session management with monotonic takeover
 * - Heartbeat/keepalive with compilation-aware suspension
 * - Message routing with ACK support
 * - Command/response correlation
 * - Graceful reconnection handling
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { createLogger } from './config';
import {
    ExtendedConnection,
    MovesiaMessage,
    ConnectionState,
    ConnectionSource,
    UnityManagerConfig,
    DEFAULT_UNITY_MANAGER_CONFIG,
    CloseCode,
    SessionEntry,
    createExtendedConnection
} from './types';
import { UnitySessionManager } from './sessions';
import { HeartbeatManager } from './heartbeat';
import { MessageRouter, CommandRouter, RouterCallbacks } from './router';
import { sendToClient, sendWelcome } from './transport';

const logger = createLogger('movesia.unity');

// =============================================================================
// Types
// =============================================================================

/** Callback for connection state changes. */
export type ConnectionChangeCallback = (connected: boolean) => Promise<void>;

/** Callback for domain events. */
export type DomainEventCallback = (msg: MovesiaMessage) => Promise<void>;

/** Interrupt manager interface (for async operations). */
export interface InterruptManager {
    resumeAll(): Promise<void>;
}

// =============================================================================
// Unity Manager
// =============================================================================

/**
 * Manages WebSocket connections from Unity Editor.
 *
 * Architecture: All Unity instances connect and stay connected.
 * Commands are routed only to the connection matching _targetProjectPath.
 * Non-target connections are idle (heartbeats only).
 *
 * Features:
 * - Multiple simultaneous connections (one per Unity project)
 * - Automatic takeover of older connections (same session)
 * - Heartbeat with compilation-aware suspension
 * - Command/response correlation for tool calls
 * - Interrupt support for async operations
 * - Instant target project switching (no reconnection needed)
 *
 * Usage:
 *     const manager = new UnityManager();
 *
 *     // In WebSocket endpoint
 *     await manager.handleConnection(websocket);
 *
 *     // From tools
 *     const result = await manager.sendAndWait("query_hierarchy", { path: "/" });
 */
export class UnityManager {
    readonly config: UnityManagerConfig;
    private _interruptManager?: InterruptManager;
    private _onDomainEvent?: DomainEventCallback;

    // Session management (holds ALL connections)
    private _sessions: UnitySessionManager;

    // Heartbeat management
    private _heartbeat: HeartbeatManager;

    // Message routing
    private _router: MessageRouter;

    // Command routing for request/response
    private _commandRouter: CommandRouter;

    // Target project — commands are routed to the connection matching this path
    private _targetProjectPath?: string;

    // Connection change callbacks
    private _connectionCallbacks: ConnectionChangeCallback[] = [];

    // Pending commands awaiting responses (keyed by message ID)
    private _pendingCommands: Map<string, {
        resolve: (value: Record<string, unknown>) => void;
        reject: (reason: Error) => void;
    }> = new Map();

    // Pending refresh/compilation commands — NOT cancelled during compilation
    // These survive domain reloads because Unity sends compilation_complete after reconnecting
    private _pendingRefreshCommands: Map<string, {
        resolve: (value: Record<string, unknown>) => void;
        reject: (reason: Error) => void;
    }> = new Map();

    constructor(options: {
        interruptManager?: InterruptManager;
        config?: Partial<UnityManagerConfig>;
        onDomainEvent?: DomainEventCallback;
    } = {}) {
        this.config = { ...DEFAULT_UNITY_MANAGER_CONFIG, ...options.config };
        this._interruptManager = options.interruptManager;
        this._onDomainEvent = options.onDomainEvent;

        // Session management
        this._sessions = new UnitySessionManager();

        // Heartbeat management
        this._heartbeat = new HeartbeatManager({
            config: this.config.heartbeat,
            getConnections: () => this._getAllConnections(),
            sendPing: (ws, cid) => this._sendPing(ws, cid),
            closeConnection: (ws, code, reason) => this._closeConnection(ws, code, reason)
        });

        // Message routing
        const routerCallbacks: RouterCallbacks = {
            suspendHeartbeat: (ms) => this._heartbeat.suspend(ms),
            onDomainEvent: (msg) => this._handleDomainEvent(msg),
            sendToClient: (ws, msg) => this._sendToWebsocket(ws, msg),
            onCompilationStarted: (cid) => this._onCompilationStarted(cid),
            onCompilationFinished: (cid) => this._onCompilationFinished(cid)
        };
        this._router = new MessageRouter(routerCallbacks);

        // Command routing
        this._commandRouter = new CommandRouter();
    }

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Handle a new Unity WebSocket connection.
     *
     * Accepts ALL connections regardless of project path.
     * The connection is stored in the session manager and kept alive.
     * Commands are only routed to the connection matching _targetProjectPath.
     *
     * @param websocket - WebSocket connection
     * @param sessionId - Session identifier (from query param or handshake)
     * @param connSeq - Connection sequence number for takeover logic
     * @param projectPath - Unity project path (from query param)
     */
    async handleConnection(
        websocket: WebSocket,
        providedSessionId?: string,
        connSeq: number = 0,
        projectPath?: string
    ): Promise<void> {
        // Generate connection ID
        const cid = this._generateCid();

        // Session and connSeq come from URL query params (no handshake needed)
        const sessionId: string = providedSessionId ?? randomUUID();

        // Create connection metadata
        const connection = createExtendedConnection(cid, {
            session: sessionId,
            connSeq,
            projectPath
        });

        // Try to accept the session
        const decision = await this._sessions.accept(
            sessionId,
            connSeq,
            connection,
            websocket,
            projectPath
        );

        if (!decision.accept) {
            logger.info(`Rejecting connection [${cid}]: ${decision.reason}`);
            websocket.close(CloseCode.DUPLICATE_SESSION, decision.reason ?? 'duplicate session');
            return;
        }

        // Supersede old connection if needed (same session, newer connSeq)
        if (decision.supersede) {
            try {
                decision.supersede.close(CloseCode.SUPERSEDED, 'superseded by newer connection');
            } catch (error) {
                logger.debug(`Error closing superseded connection: ${error}`);
            }
        }

        connection.state = ConnectionState.OPEN;

        // Start heartbeat if not running
        this._heartbeat.start();

        // Only notify "connected" if this connection matches the target project
        const isTargetProject = this._isTargetProject(projectPath);
        if (isTargetProject) {
            await this._notifyConnectionChange(true);
        }

        // Send welcome message
        await sendWelcome(websocket, {
            cid,
            session: sessionId,
            server_version: '2.0.0'
        });

        const shortSession = sessionId.substring(0, 8);
        const targetLabel = isTargetProject ? ' [TARGET]' : '';
        logger.info(`Unity connected [${cid}] session=${shortSession} project="${projectPath ?? 'unknown'}"${targetLabel}`);

        // Set up event handlers
        websocket.on('message', async (data) => {
            try {
                await this._handleMessage(websocket, connection, data);
            } catch (error) {
                logger.error(`Error handling message [${cid}]`, error as Error);
            }
        });

        websocket.on('close', async (code, _reason) => {
            logger.info(`Unity disconnected [${cid}] code=${code}`);
            await this._cleanupConnection(websocket, connection, sessionId);
        });

        websocket.on('error', async (error) => {
            logger.error(`Unity connection error [${cid}]`, error);
            await this._cleanupConnection(websocket, connection, sessionId);
        });
    }

    /**
     * Send a command to Unity and wait for response.
     *
     * Routes the command to the connection matching _targetProjectPath.
     *
     * @param commandType - Type of command (e.g., "query_hierarchy")
     * @param params - Command parameters
     * @param timeout - Timeout in seconds (defaults to config)
     * @returns Response body from Unity
     * @throws Error if no Unity connection for target project
     * @throws Error if response times out
     */
    async sendAndWait(
        commandType: string,
        params: Record<string, unknown> = {},
        timeout?: number
    ): Promise<Record<string, unknown>> {
        const activeSession = await this._getActiveSession();
        if (!activeSession) {
            throw new Error('No Unity connection available for target project');
        }

        const { websocket: ws, connection, sessionId } = activeSession;
        const timeoutMs = (timeout ?? this.config.commandTimeout) * 1000;

        // Create and send command
        const msg = MovesiaMessage.create(
            commandType,
            params,
            ConnectionSource.VSCODE,
            sessionId
        );

        // Register for response using message ID (Unity echoes this back)
        const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
            this._pendingCommands.set(msg.id, { resolve, reject });
        });

        // Set up timeout
        const timeoutId = setTimeout(() => {
            const pending = this._pendingCommands.get(msg.id);
            if (pending) {
                this._pendingCommands.delete(msg.id);
                pending.reject(new Error(`Command ${commandType} timed out after ${timeoutMs}ms`));
            }
        }, timeoutMs);

        logger.info(`Registered pending command: msg.id=${msg.id}`);

        try {
            await sendToClient(ws, msg.toDict());
            logger.info(`Sent command ${commandType} [msg.id=${msg.id}]`);

            return await responsePromise;
        } finally {
            clearTimeout(timeoutId);
            this._pendingCommands.delete(msg.id);
        }
    }

    /**
     * Send a refresh/compilation command and wait for response.
     *
     * Unlike sendAndWait, this method:
     * - Uses a longer timeout (interruptTimeout, default 120s)
     * - Is NOT cancelled when compilation starts (_onCompilationStarted)
     * - Matches compilation_complete responses that arrive after domain reload/reconnect
     *
     * Flow:
     * 1. Sends refresh_assets command to Unity
     * 2. Unity triggers AssetDatabase.Refresh() and may start compilation
     * 3. If compilation happens, Unity domain reloads (WebSocket drops)
     * 4. After reload, Unity reconnects and sends compilation_complete with original msg ID
     * 5. This method resolves with the compilation result
     *
     * @param commandType - Type of command (e.g., "refresh_assets")
     * @param params - Command parameters
     * @returns Response body from Unity (compilation_complete body)
     * @throws Error if no Unity connection for target project
     * @throws Error if response times out
     */
    async sendRefreshAndWait(
        commandType: string,
        params: Record<string, unknown> = {}
    ): Promise<Record<string, unknown>> {
        const activeSession = await this._getActiveSession();
        if (!activeSession) {
            throw new Error('No Unity connection available for target project');
        }

        const { websocket: ws, connection, sessionId } = activeSession;
        const timeoutMs = this.config.interruptTimeout * 1000; // 120s default

        // Create and send command
        const msg = MovesiaMessage.create(
            commandType,
            params,
            ConnectionSource.VSCODE,
            sessionId
        );

        // Register in the compilation-safe pending map (NOT in _pendingCommands)
        const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
            this._pendingRefreshCommands.set(msg.id, { resolve, reject });
        });

        // Set up timeout
        const timeoutId = setTimeout(() => {
            const pending = this._pendingRefreshCommands.get(msg.id);
            if (pending) {
                this._pendingRefreshCommands.delete(msg.id);
                pending.reject(new Error(`Refresh command ${commandType} timed out after ${timeoutMs}ms`));
            }
        }, timeoutMs);

        try {
            await sendToClient(ws, msg.toDict());
            return await responsePromise;
        } finally {
            clearTimeout(timeoutId);
            this._pendingRefreshCommands.delete(msg.id);
        }
    }

    /**
     * Check if Unity is currently connected (for the target project).
     */
    get isConnected(): boolean {
        if (!this._targetProjectPath) {
            return false;
        }
        // Synchronous check — look through sessions for matching project
        return this._hasActiveSessionSync();
    }

    /**
     * Get current target Unity project path.
     */
    get currentProject(): string | undefined {
        return this._targetProjectPath;
    }

    /**
     * Check if the target Unity project is currently compiling.
     */
    get isCompiling(): boolean {
        const session = this._getActiveSessionSync();
        return session?.connection.isCompiling ?? false;
    }

    /**
     * Get number of active connections (all projects).
     */
    get connectionCount(): number {
        return this._sessions.size;
    }

    /**
     * Register callback for connection state changes.
     */
    onConnectionChange(callback: ConnectionChangeCallback): void {
        this._connectionCallbacks.push(callback);
    }

    /**
     * Close all Unity connections.
     */
    async closeAll(): Promise<void> {
        this._heartbeat.stop();
        this._commandRouter.cancelAll();

        // Cancel all pending refresh commands (server is shutting down)
        for (const [_requestId, pending] of this._pendingRefreshCommands) {
            pending.reject(new Error('All connections closed'));
        }
        this._pendingRefreshCommands.clear();

        const sessions = await this._sessions.getAllSessions();
        for (const [_sessionId, entry] of sessions) {
            try {
                entry.websocket.close(CloseCode.GOING_AWAY, 'server shutdown');
            } catch {
                // Ignore close errors
            }
        }

        await this._sessions.clearAll();
    }

    /**
     * Set the target project path.
     * Commands will be routed to the Unity instance matching this path.
     * If a connection already exists for this project, notifies connected.
     * Other connections are NOT disconnected — they stay idle.
     */
    async setTargetProject(projectPath: string): Promise<void> {
        const oldTarget = this._targetProjectPath;
        this._targetProjectPath = projectPath;
        logger.info(`Target project set: ${projectPath}`);

        // Check if we already have a connection for the new target
        const session = await this._sessions.getSessionForProject(projectPath);
        if (session && session.connection.state === ConnectionState.OPEN) {
            logger.info(`Already connected to target project — activating`);
            await this._notifyConnectionChange(true);
        } else if (oldTarget !== projectPath) {
            // Switching to a project we don't have a connection for
            await this._notifyConnectionChange(false);
        }
    }

    /**
     * Get the current target project path.
     */
    get targetProjectPath(): string | undefined {
        return this._targetProjectPath;
    }

    /**
     * Get all connected project paths.
     */
    async getConnectedProjects(): Promise<string[]> {
        const sessions = await this._sessions.getAllSessions();
        const projects: string[] = [];
        for (const [, entry] of sessions) {
            if (entry.connection.projectPath && entry.connection.state === ConnectionState.OPEN) {
                projects.push(entry.connection.projectPath);
            }
        }
        return projects;
    }

    // =========================================================================
    // Private Implementation
    // =========================================================================

    /**
     * Get the active session for the target project (async).
     */
    private async _getActiveSession(): Promise<{ websocket: WebSocket; connection: ExtendedConnection; sessionId: string } | undefined> {
        if (!this._targetProjectPath) {
            return undefined;
        }

        // Look up session by project path (uses normalized path matching)
        const sessions = await this._sessions.getAllSessions();
        for (const [sessionId, entry] of sessions) {
            if (
                entry.connection.projectPath &&
                entry.connection.state === ConnectionState.OPEN &&
                this._pathsMatch(entry.connection.projectPath, this._targetProjectPath)
            ) {
                return { websocket: entry.websocket, connection: entry.connection, sessionId };
            }
        }

        return undefined;
    }

    /**
     * Synchronous check if we have an active session for the target project.
     * Used by getters that can't be async.
     */
    private _hasActiveSessionSync(): boolean {
        return this._getActiveSessionSync() !== undefined;
    }

    /**
     * Synchronous lookup of active session for target project.
     * Accesses the session manager's internal map directly.
     */
    private _getActiveSessionSync(): SessionEntry | undefined {
        if (!this._targetProjectPath) {
            return undefined;
        }

        // Access sessions synchronously (Map is sync, the async wrapper is just for interface consistency)
        for (const entry of (this._sessions as any)._sessions.values()) {
            if (
                entry.connection.projectPath &&
                entry.connection.state === ConnectionState.OPEN &&
                this._pathsMatch(entry.connection.projectPath, this._targetProjectPath)
            ) {
                return entry;
            }
        }
        return undefined;
    }

    /**
     * Check if a project path matches the current target.
     */
    private _isTargetProject(projectPath?: string): boolean {
        if (!this._targetProjectPath || !projectPath) {
            return false;
        }
        return this._pathsMatch(projectPath, this._targetProjectPath);
    }

    /**
     * Handle incoming message.
     */
    private async _handleMessage(
        websocket: WebSocket,
        connection: ExtendedConnection,
        data: Buffer | ArrayBuffer | Buffer[]
    ): Promise<void> {
        const rawData = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

        // Route through message router
        const msg = await this._router.handleMessage(websocket, connection, rawData);

        if (!msg) {
            return;
        }

        // Check if this is a response to a pending refresh/compilation command FIRST
        // compilation_complete messages carry the original request's msg.id
        const pendingRefresh = this._pendingRefreshCommands.get(msg.id);
        if (pendingRefresh) {
            this._pendingRefreshCommands.delete(msg.id);
            pendingRefresh.resolve(msg.body);
            return;
        }

        // Check if this is a response to a pending regular command (matched by message ID)
        // Unity echoes back the original message ID in its response
        const pending = this._pendingCommands.get(msg.id);
        if (pending) {
            this._pendingCommands.delete(msg.id);
            pending.resolve(msg.body);
        }
    }

    /**
     * Clean up after connection closes.
     */
    private async _cleanupConnection(
        websocket: WebSocket,
        connection: ExtendedConnection,
        sessionId: string
    ): Promise<void> {
        connection.state = ConnectionState.CLOSED;

        // Check if this was the target project's connection BEFORE clearing
        const wasTargetProject = this._isTargetProject(connection.projectPath);

        // Clear from sessions
        await this._sessions.clearIfMatch(sessionId, websocket);

        // Cancel regular pending commands only if this was the target project
        // NOTE: Do NOT cancel _pendingRefreshCommands — Unity will reconnect after domain reload
        if (wasTargetProject) {
            const regularCount = this._pendingCommands.size;
            for (const [_requestId, pending] of this._pendingCommands) {
                pending.reject(new Error('Connection closed'));
            }
            this._pendingCommands.clear();

            // Notify disconnection
            await this._notifyConnectionChange(false);
        }

        // Stop heartbeat if no more connections at all
        if (this._sessions.size === 0) {
            this._heartbeat.stop();
        }

        logger.info(`Cleaned up connection [${connection.cid}] project="${connection.projectPath ?? 'unknown'}"`);
    }

    /**
     * Forward domain events to subscribers.
     */
    private async _handleDomainEvent(msg: MovesiaMessage): Promise<void> {
        if (this._onDomainEvent) {
            try {
                await this._onDomainEvent(msg);
            } catch (error) {
                logger.error('Error in domain event handler', error as Error);
            }
        }
    }

    /**
     * Handle Unity compilation start.
     */
    private async _onCompilationStarted(cid: string): Promise<void> {
        logger.info(`Unity compilation started [${cid}]`);

        // Cancel regular pending commands (they'll fail during domain reload)
        // NOTE: Do NOT cancel _pendingRefreshCommands — those survive compilation
        for (const [_requestId, pending] of this._pendingCommands) {
            pending.reject(new Error('Compilation started'));
        }
        this._pendingCommands.clear();
    }

    /**
     * Handle Unity compilation finish.
     */
    private async _onCompilationFinished(cid: string): Promise<void> {
        logger.info(`Unity compilation finished [${cid}]`);

        // Resume any interrupted operations
        if (this._interruptManager) {
            try {
                await this._interruptManager.resumeAll();
            } catch (error) {
                logger.error('Error resuming interrupts', error as Error);
            }
        }
    }

    /**
     * Notify all connection change callbacks.
     */
    private async _notifyConnectionChange(connected: boolean): Promise<void> {
        for (const callback of this._connectionCallbacks) {
            try {
                await callback(connected);
            } catch (error) {
                logger.error('Error in connection change callback', error as Error);
            }
        }
    }

    /**
     * Get all connections for heartbeat manager.
     */
    private async _getAllConnections(): Promise<Map<string, SessionEntry>> {
        return this._sessions.getAllSessions();
    }

    /**
     * Send ping to a connection.
     */
    private async _sendPing(ws: WebSocket, cid: string): Promise<void> {
        const msg = MovesiaMessage.create('hb', {}, ConnectionSource.VSCODE);
        try {
            await sendToClient(ws, msg.toDict());
        } catch (error) {
            logger.debug(`Failed to send ping to [${cid}]: ${error}`);
        }
    }

    /**
     * Close a WebSocket connection.
     */
    private async _closeConnection(
        ws: WebSocket,
        code: number,
        reason: string
    ): Promise<void> {
        try {
            ws.close(code, reason);
        } catch (error) {
            logger.debug(`Error closing connection: ${error}`);
        }
    }

    /**
     * Send message to a WebSocket.
     */
    private async _sendToWebsocket(
        ws: WebSocket,
        message: Record<string, unknown>
    ): Promise<void> {
        await sendToClient(ws, message);
    }

    /**
     * Compare two file paths for equality, normalizing separators and case.
     * Handles Windows vs Unix path differences (backslash vs forward slash,
     * case-insensitive on Windows).
     */
    private _pathsMatch(a: string, b: string): boolean {
        const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        return normalize(a) === normalize(b);
    }

    /**
     * Generate a short connection ID.
     */
    private _generateCid(): string {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 8; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Unity manager with default configuration.
 */
export function createUnityManager(options: {
    interruptManager?: InterruptManager;
    onDomainEvent?: DomainEventCallback;
} = {}): UnityManager {
    return new UnityManager(options);
}
