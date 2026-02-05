/**
 * Improved Unity Manager for WebSocket connection management.
 *
 * Integrates all the best practices:
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
 * Features:
 * - Single active connection per project/session
 * - Automatic takeover of older connections
 * - Heartbeat with compilation-aware suspension
 * - Command/response correlation for tool calls
 * - Interrupt support for async operations
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

    // Session management
    private _sessions: UnitySessionManager;

    // Heartbeat management
    private _heartbeat: HeartbeatManager;

    // Message routing
    private _router: MessageRouter;

    // Command routing for request/response
    private _commandRouter: CommandRouter;

    // Current connection tracking (for single Unity connection)
    private _currentWs?: WebSocket;
    private _currentConnection?: ExtendedConnection;
    private _currentSession?: string;

    // Connection change callbacks
    private _connectionCallbacks: ConnectionChangeCallback[] = [];

    // Pending commands awaiting responses (keyed by message ID)
    private _pendingCommands: Map<string, {
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
     * This is the main entry point called from the WebSocket endpoint.
     *
     * @param websocket - WebSocket connection
     * @param sessionId - Session identifier (from query param or handshake)
     * @param connSeq - Connection sequence number for takeover logic
     */
    async handleConnection(
        websocket: WebSocket,
        providedSessionId?: string,
        connSeq: number = 0
    ): Promise<void> {
        // Generate connection ID
        const cid = this._generateCid();

        // Session and connSeq come from URL query params (no handshake needed)
        const sessionId: string = providedSessionId ?? randomUUID();

        // Create connection metadata
        const connection = createExtendedConnection(cid, {
            session: sessionId,
            connSeq
        });

        // Try to accept the session
        const decision = await this._sessions.accept(
            sessionId,
            connSeq,
            connection,
            websocket
        );

        if (!decision.accept) {
            logger.info(`Rejecting connection [${cid}]: ${decision.reason}`);
            websocket.close(CloseCode.DUPLICATE_SESSION, decision.reason ?? 'duplicate session');
            return;
        }

        // Supersede old connection if needed
        if (decision.supersede) {
            try {
                decision.supersede.close(CloseCode.SUPERSEDED, 'superseded by newer connection');
            } catch (error) {
                logger.debug(`Error closing superseded connection: ${error}`);
            }
        }

        // Update current connection
        this._currentWs = websocket;
        this._currentConnection = connection;
        this._currentSession = sessionId;
        connection.state = ConnectionState.OPEN;

        // Start heartbeat if not running
        this._heartbeat.start();

        // Notify connection change
        await this._notifyConnectionChange(true);

        // Send welcome message
        await sendWelcome(websocket, {
            cid,
            session: sessionId,
            server_version: '2.0.0'
        });

        const shortSession = sessionId.substring(0, 8);
        logger.info(`Unity connected [${cid}] session=${shortSession}`);

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
     * @param commandType - Type of command (e.g., "query_hierarchy")
     * @param params - Command parameters
     * @param timeout - Timeout in seconds (defaults to config)
     * @returns Response body from Unity
     * @throws Error if no Unity connection
     * @throws Error if response times out
     */
    async sendAndWait(
        commandType: string,
        params: Record<string, unknown> = {},
        timeout?: number
    ): Promise<Record<string, unknown>> {
        if (!this._currentWs || !this._currentConnection) {
            throw new Error('No Unity connection available');
        }

        const timeoutMs = (timeout ?? this.config.commandTimeout) * 1000;

        // Create and send command
        const msg = MovesiaMessage.create(
            commandType,
            params,
            ConnectionSource.VSCODE,
            this._currentSession
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
            await sendToClient(this._currentWs, msg.toDict());
            logger.info(`Sent command ${commandType} [msg.id=${msg.id}]`);

            return await responsePromise;
        } finally {
            clearTimeout(timeoutId);
            this._pendingCommands.delete(msg.id);
        }
    }

    /**
     * Check if Unity is currently connected.
     */
    get isConnected(): boolean {
        return (
            this._currentWs !== undefined &&
            this._currentConnection !== undefined &&
            this._currentConnection.state === ConnectionState.OPEN
        );
    }

    /**
     * Get current Unity project path.
     */
    get currentProject(): string | undefined {
        return this._currentConnection?.projectPath;
    }

    /**
     * Check if Unity is currently compiling.
     */
    get isCompiling(): boolean {
        return this._currentConnection?.isCompiling ?? false;
    }

    /**
     * Get number of active connections.
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

        const sessions = await this._sessions.getAllSessions();
        for (const [_sessionId, entry] of sessions) {
            try {
                entry.websocket.close(CloseCode.GOING_AWAY, 'server shutdown');
            } catch {
                // Ignore close errors
            }
        }

        await this._sessions.clearAll();
        this._currentWs = undefined;
        this._currentConnection = undefined;
        this._currentSession = undefined;
    }

    // =========================================================================
    // Private Implementation
    // =========================================================================

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

        // Check if this is a response to a pending command (matched by message ID)
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

        // Clear from sessions
        await this._sessions.clearIfMatch(sessionId, websocket);

        // Clear current connection if it matches
        if (this._currentWs === websocket) {
            this._currentWs = undefined;
            this._currentConnection = undefined;
            this._currentSession = undefined;
        }

        // Cancel pending commands
        for (const [_requestId, pending] of this._pendingCommands) {
            pending.reject(new Error('Connection closed'));
        }
        this._pendingCommands.clear();

        // Notify connection change
        await this._notifyConnectionChange(false);

        // Stop heartbeat if no more connections
        if (this._sessions.size === 0) {
            this._heartbeat.stop();
        }

        logger.info(`Cleaned up connection [${connection.cid}]`);
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

        // Cancel pending commands (they'll fail anyway)
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
