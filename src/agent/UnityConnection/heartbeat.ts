/**
 * Heartbeat Manager for WebSocket connection health monitoring.
 *
 * Implements:
 * - Periodic health checks using ping/pong
 * - Idle connection detection and cleanup
 * - Compilation-aware suspension (critical for Unity)
 * - Latency measurement
 * - Graceful connection termination
 *
 * The heartbeat is essential for:
 * 1. Detecting silently dropped connections (no TCP RST received)
 * 2. Keeping connections alive through NAT/proxies
 * 3. Measuring connection quality (latency)
 * 4. Cleaning up zombie connections
 */

import { WebSocket } from 'ws';
import { createLogger } from './config';
import {
    HeartbeatConfig,
    DEFAULT_HEARTBEAT_CONFIG,
    ExtendedConnection,
    ConnectionState,
    SessionEntry,
    markPongReceived,
    updateConnectionSeen
} from './types';

const logger = createLogger('movesia.heartbeat');

// =============================================================================
// Types
// =============================================================================

/** Callback to get all current connections. */
export type GetConnectionsCallback = () => Promise<Map<string, SessionEntry>>;

/** Callback to send ping to a websocket. */
export type SendPingCallback = (ws: WebSocket, cid: string) => Promise<void>;

/** Callback to close a connection. */
export type CloseConnectionCallback = (ws: WebSocket, code: number, reason: string) => Promise<void>;

// =============================================================================
// Heartbeat Manager
// =============================================================================

/**
 * Manages heartbeat/keepalive for WebSocket connections.
 *
 * Key features:
 * - Configurable intervals and timeouts
 * - Suspension during Unity compilation
 * - Per-connection health tracking
 * - Background task for periodic sweeps
 */
export class HeartbeatManager {
    private config: HeartbeatConfig;
    private _getConnections?: GetConnectionsCallback;
    private _sendPing?: SendPingCallback;
    private _closeConnection?: CloseConnectionCallback;
    private _now: () => number;

    private _intervalId?: NodeJS.Timeout;
    private _running = false;
    private _suspendUntil = 0;

    // Track pending pings: cid -> ping_sent_time
    private _pendingPings: Map<string, number> = new Map();

    constructor(options: {
        config?: HeartbeatConfig;
        getConnections?: GetConnectionsCallback;
        sendPing?: SendPingCallback;
        closeConnection?: CloseConnectionCallback;
        now?: () => number;
    } = {}) {
        this.config = options.config ?? DEFAULT_HEARTBEAT_CONFIG;
        this._getConnections = options.getConnections;
        this._sendPing = options.sendPing;
        this._closeConnection = options.closeConnection;
        this._now = options.now ?? (() => Date.now() / 1000);
    }

    /**
     * Start the heartbeat background task.
     */
    start(): void {
        if (this._running) {
            return;
        }

        this._running = true;
        const sweepInterval = this.config.sweepIntervalMs;

        this._intervalId = setInterval(async () => {
            if (!this._running) {
                return;
            }

            // Skip sweep if suspended
            if (this.isSuspended()) {
                return;
            }

            try {
                await this._sweepConnections();
            } catch (error) {
                logger.error('Error in heartbeat loop', error as Error);
            }
        }, sweepInterval);

        logger.debug('Heartbeat started');
    }

    /**
     * Stop the heartbeat background task.
     */
    stop(): void {
        this._running = false;
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = undefined;
        }
        logger.debug('Heartbeat stopped');
    }

    /**
     * Suspend heartbeat checks for a duration.
     *
     * Use this during Unity compilation to avoid false disconnections.
     *
     * @param durationMs - How long to suspend in milliseconds
     */
    suspend(durationMs: number): void {
        const suspendUntil = this._now() + (durationMs / 1000);

        // Only extend, never shorten
        if (suspendUntil > this._suspendUntil) {
            this._suspendUntil = suspendUntil;
            logger.debug(`Heartbeat suspended for ${durationMs}ms`);
        }
    }

    /**
     * Check if heartbeat is currently suspended.
     */
    isSuspended(): boolean {
        return this._now() < this._suspendUntil;
    }

    /**
     * Handle pong receipt from a connection.
     *
     * @param cid - Connection ID
     * @param connection - Connection metadata to update
     */
    async handlePong(cid: string, connection: ExtendedConnection): Promise<void> {
        const pingTime = this._pendingPings.get(cid);
        this._pendingPings.delete(cid);

        if (pingTime) {
            markPongReceived(connection, pingTime);
        } else {
            // Unsolicited pong (unidirectional heartbeat from client)
            updateConnectionSeen(connection);
        }
    }

    /**
     * Perform one heartbeat sweep over all connections.
     */
    private async _sweepConnections(): Promise<void> {
        if (!this._getConnections) {
            return;
        }

        const now = this._now();
        const connections = await this._getConnections();

        if (connections.size === 0) {
            return;
        }

        for (const [sessionId, entry] of connections) {
            try {
                await this._checkConnection(sessionId, entry, now);
            } catch (error) {
                logger.error(`Error checking connection [${sessionId}]`, error as Error);
            }
        }
    }

    /**
     * Check health of a single connection.
     *
     * Implements the state machine:
     * 1. CLOSING -> Force kill if stuck too long
     * 2. Active -> Skip if not idle enough
     * 3. Idle -> Send ping if isAlive
     * 4. Not responding -> Increment missed, terminate if too many
     */
    private async _checkConnection(
        _sessionId: string,
        entry: SessionEntry,
        now: number
    ): Promise<void> {
        const conn = entry.connection;
        const ws = entry.websocket;

        // Handle connections stuck in CLOSING state
        if (conn.state === ConnectionState.CLOSING) {
            if (conn.closingSince) {
                const closingDuration = now - conn.closingSince;
                if (closingDuration > (this.config.closingForceKillMs / 1000)) {
                    await this._terminate(ws, conn.cid);
                }
            }
            return;
        }

        // Only check OPEN connections
        if (conn.state !== ConnectionState.OPEN) {
            return;
        }

        // Calculate idle time
        const idleMs = (now - conn.lastSeen) * 1000;

        // Check max idle - disconnect if too long
        if (idleMs > this.config.maxIdleMs) {
            logger.info(`Connection [${conn.cid}] idle timeout`);
            await this._close(ws, conn.cid, 1001, 'idle timeout');
            return;
        }

        // Not idle enough for ping yet
        if (idleMs <= this.config.pingAfterIdleMs) {
            conn.isAlive = true;
            conn.missedPongs = 0;
            return;
        }

        // Connection is idle - check if we got response to last ping
        if (!conn.isAlive) {
            conn.missedPongs += 1;

            if (conn.missedPongs >= this.config.maxMissedPongs) {
                logger.info(`Connection [${conn.cid}] missed ${conn.missedPongs} pongs, terminating`);
                await this._terminate(ws, conn.cid);
                return;
            }
        }

        // Send ping
        conn.isAlive = false;
        await this._sendPingTo(ws, conn.cid, now);
    }

    /**
     * Send a ping frame to a connection.
     */
    private async _sendPingTo(ws: WebSocket, cid: string, now: number): Promise<void> {
        if (!this._sendPing) {
            return;
        }

        try {
            this._pendingPings.set(cid, now);
            await this._sendPing(ws, cid);
        } catch (error) {
            logger.error(`Failed to send ping to [${cid}]`, error as Error);
            this._pendingPings.delete(cid);
        }
    }

    /**
     * Close a connection gracefully.
     */
    private async _close(ws: WebSocket, cid: string, code: number, reason: string): Promise<void> {
        if (!this._closeConnection) {
            return;
        }

        try {
            await this._closeConnection(ws, code, reason);
        } catch (error) {
            logger.error(`Failed to close [${cid}]`, error as Error);
        }
    }

    /**
     * Forcefully terminate a connection.
     */
    private async _terminate(ws: WebSocket, cid: string): Promise<void> {
        this._pendingPings.delete(cid);
        await this._close(ws, cid, 1011, 'terminated');
    }
}

// =============================================================================
// Application Heartbeat
// =============================================================================

/**
 * Application-level heartbeat for Unity connections.
 *
 * Unity's WebSocket libraries don't always support protocol-level ping/pong,
 * so we implement an application-level heartbeat using regular messages.
 *
 * This sends/expects messages like:
 * {
 *     "source": "vscode",
 *     "type": "hb",  // or "pong"
 *     "ts": 1234567890,
 *     "id": "...",
 *     "body": {}
 * }
 */
export class ApplicationHeartbeat {
    private _sendMessage?: (ws: WebSocket, message: Record<string, unknown>) => Promise<void>;
    private _pending: Map<string, number> = new Map();  // msgId -> sentTime

    constructor(options: {
        config?: HeartbeatConfig;
        sendMessage?: (ws: WebSocket, message: Record<string, unknown>) => Promise<void>;
    } = {}) {
        // Config stored for potential future use
        void options.config;  // Consume to satisfy TypeScript
        this._sendMessage = options.sendMessage;
    }

    /**
     * Send an application-level heartbeat message.
     */
    async sendHeartbeat(ws: WebSocket, msgId: string): Promise<void> {
        if (!this._sendMessage) {
            return;
        }

        const message = {
            source: 'vscode',
            type: 'hb',
            ts: Math.floor(Date.now() / 1000),
            id: msgId,
            body: {}
        };

        this._pending.set(msgId, Date.now() / 1000);
        await this._sendMessage(ws, message);
    }

    /**
     * Handle heartbeat response, return latency in ms if matched.
     *
     * @param msgId - Message ID from response
     * @returns Latency in milliseconds, or undefined if no matching ping
     */
    handleHeartbeatResponse(msgId: string): number | undefined {
        const sentTime = this._pending.get(msgId);
        this._pending.delete(msgId);

        if (sentTime) {
            return (Date.now() / 1000 - sentTime) * 1000;
        }
        return undefined;
    }

    /**
     * Clear a pending heartbeat (e.g., on disconnect).
     */
    clearPending(msgId: string): void {
        this._pending.delete(msgId);
    }

    /**
     * Clear all pending heartbeats.
     */
    clearAllPending(): void {
        this._pending.clear();
    }
}
