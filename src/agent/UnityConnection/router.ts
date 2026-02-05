/**
 * Message Router for WebSocket communication.
 *
 * Handles:
 * - Message parsing and validation
 * - Message type routing
 * - ACK generation for important messages
 * - Compilation event handling
 * - Domain event forwarding
 *
 * The router acts as a central hub for all incoming messages, ensuring
 * consistent handling and proper acknowledgment of important operations.
 */

import { WebSocket } from 'ws';
import { createLogger } from './config';
import {
    MovesiaMessage,
    ACK_REQUIRED_TYPES,
    ExtendedConnection,
    ConnectionSource,
    updateConnectionSeen
} from './types';

const logger = createLogger('movesia.router');

// =============================================================================
// Types
// =============================================================================

/** Callbacks for the message router. */
export interface RouterCallbacks {
    suspendHeartbeat?: (durationMs: number) => void;
    onDomainEvent?: (msg: MovesiaMessage) => Promise<void>;
    sendToClient?: (ws: WebSocket, message: Record<string, unknown>) => Promise<void>;
    onCompilationStarted?: (cid: string) => Promise<void>;
    onCompilationFinished?: (cid: string) => Promise<void>;
}

// =============================================================================
// Message Router
// =============================================================================

/**
 * Routes and processes incoming WebSocket messages.
 *
 * Responsibilities:
 * - Parse and validate message format
 * - Route messages to appropriate handlers
 * - Send acknowledgments for important messages
 * - Handle compilation events specially
 * - Forward domain events to subscribers
 */
export class MessageRouter {
    /** Compilation suspend durations. */
    private static readonly COMPILE_START_SUSPEND_MS = 120_000;  // 2 minutes
    private static readonly COMPILE_FINISH_SUSPEND_MS = 30_000;  // 30 seconds (grace period)

    private callbacks: RouterCallbacks;

    constructor(callbacks: RouterCallbacks = {}) {
        this.callbacks = callbacks;
    }

    /**
     * Handle an incoming WebSocket message.
     *
     * @param ws - WebSocket connection
     * @param connection - Extended connection metadata
     * @param rawData - Raw message data (string or Buffer)
     * @returns Parsed MovesiaMessage if valid and not internal, undefined otherwise
     */
    async handleMessage(
        ws: WebSocket,
        connection: ExtendedConnection,
        rawData: string | Buffer
    ): Promise<MovesiaMessage | undefined> {
        // Update connection activity
        updateConnectionSeen(connection);

        // Parse the message
        let data: Record<string, unknown>;
        try {
            const text = typeof rawData === 'string' ? rawData : rawData.toString('utf-8');
            data = JSON.parse(text);
        } catch (error) {
            logger.warn(`Invalid JSON from [${connection.cid}]: ${error}`);
            return undefined;
        }

        // Validate message envelope
        const msg = this._validateMessage(data, connection.cid);
        if (!msg) {
            return undefined;
        }

        // Update session from message if present
        if (msg.session) {
            connection.session = msg.session;
        }

        // Handle special message types
        const handled = await this._handleSpecialTypes(ws, connection, msg);
        if (handled) {
            return undefined;  // Don't forward internal messages
        }

        // Send ACK if required
        if (this._shouldAck(msg.type)) {
            await this._sendAck(ws, msg.id, connection.cid);
        }

        // Forward to domain event handler
        if (this.callbacks.onDomainEvent) {
            try {
                await this.callbacks.onDomainEvent(msg);
            } catch (error) {
                logger.error('Error in domain event handler', error as Error);
            }
        }

        return msg;
    }

    /**
     * Validate message envelope format.
     *
     * @param data - Parsed JSON data
     * @param cid - Connection ID for logging
     * @returns MovesiaMessage if valid, undefined otherwise
     */
    private _validateMessage(
        data: Record<string, unknown>,
        cid: string
    ): MovesiaMessage | undefined {
        // Check required fields
        const requiredFields = ['source', 'type', 'ts', 'id'];
        const missing = requiredFields.filter(f => !(f in data));

        if (missing.length > 0) {
            logger.warn(`Invalid message from [${cid}]: missing ${missing.join(', ')}`);
            return undefined;
        }

        // Ensure body exists (default to empty dict)
        if (!('body' in data)) {
            data.body = {};
        }

        // Validate types
        if (typeof data.type !== 'string') {
            logger.warn(`Invalid message from [${cid}]: 'type' must be string`);
            return undefined;
        }

        try {
            return MovesiaMessage.fromDict(data);
        } catch (error) {
            logger.warn(`Failed to parse message from [${cid}]: ${error}`);
            return undefined;
        }
    }

    /**
     * Handle special/internal message types.
     *
     * @param ws - WebSocket connection
     * @param connection - Connection metadata
     * @param msg - Parsed message
     * @returns True if message was handled internally, False to continue processing
     */
    private async _handleSpecialTypes(
        ws: WebSocket,
        connection: ExtendedConnection,
        msg: MovesiaMessage
    ): Promise<boolean> {
        const msgType = msg.type;

        // Heartbeat/keepalive
        if (msgType === 'hb') {
            // Respond with pong
            await this._sendPong(ws, msg.id);
            return true;
        }

        // ACK (acknowledgment of our message)
        if (msgType === 'ack') {
            // Could track ACKs for delivery confirmation
            return true;
        }

        // Pong (response to our heartbeat)
        if (msgType === 'pong') {
            // Heartbeat manager handles this
            return true;
        }

        // Compilation started
        if (msgType === 'compile_started') {
            logger.info(`Unity compilation started [${connection.cid}]`);
            connection.isCompiling = true;

            if (this.callbacks.suspendHeartbeat) {
                this.callbacks.suspendHeartbeat(MessageRouter.COMPILE_START_SUSPEND_MS);
            }

            if (this.callbacks.onCompilationStarted) {
                await this.callbacks.onCompilationStarted(connection.cid);
            }

            return false;  // Still forward as domain event
        }

        // Compilation finished
        if (msgType === 'compile_finished') {
            logger.info(`Unity compilation finished [${connection.cid}]`);
            connection.isCompiling = false;

            if (this.callbacks.suspendHeartbeat) {
                this.callbacks.suspendHeartbeat(MessageRouter.COMPILE_FINISH_SUSPEND_MS);
            }

            if (this.callbacks.onCompilationFinished) {
                await this.callbacks.onCompilationFinished(connection.cid);
            }

            return false;  // Still forward as domain event
        }

        return false;
    }

    /**
     * Check if message type requires acknowledgment.
     */
    private _shouldAck(msgType: string): boolean {
        return ACK_REQUIRED_TYPES.has(msgType);
    }

    /**
     * Send acknowledgment message.
     */
    private async _sendAck(ws: WebSocket, msgId: string, _cid: string): Promise<void> {
        const ack = MovesiaMessage.create('ack', {}, ConnectionSource.VSCODE);
        // Use the original message ID for correlation
        ack.id = msgId;

        if (this.callbacks.sendToClient) {
            await this.callbacks.sendToClient(ws, ack.toDict());
        }
    }

    /**
     * Send pong response to heartbeat.
     */
    private async _sendPong(ws: WebSocket, msgId: string): Promise<void> {
        const pong = MovesiaMessage.create('pong', {}, ConnectionSource.VSCODE);
        pong.id = msgId;  // Echo back the heartbeat ID

        if (this.callbacks.sendToClient) {
            await this.callbacks.sendToClient(ws, pong.toDict());
        }
    }
}

// =============================================================================
// Command Router
// =============================================================================

/**
 * Routes outgoing commands to Unity and tracks responses.
 *
 * Provides request/response correlation for commands that expect
 * results from Unity, using request IDs to match responses.
 */
export class CommandRouter {
    private _pending: Map<string, {
        resolve: (value: Record<string, unknown>) => void;
        reject: (reason: Error) => void;
    }> = new Map();

    /**
     * Send a command and wait for response.
     *
     * @param ws - WebSocket to send through
     * @param commandType - Type of command
     * @param body - Command body/parameters
     * @param sendFunc - Function to send the message
     * @param timeout - How long to wait for response (ms)
     * @returns Response body
     * @throws Error if no response within timeout
     */
    async sendCommand(
        ws: WebSocket,
        commandType: string,
        body: Record<string, unknown>,
        sendFunc: (ws: WebSocket, message: Record<string, unknown>) => Promise<void>,
        timeout: number = 30000
    ): Promise<Record<string, unknown>> {
        const msg = MovesiaMessage.create(commandType, body, ConnectionSource.VSCODE);

        // Create promise for response
        const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
            this._pending.set(msg.id, { resolve, reject });
        });

        // Set up timeout
        const timeoutId = setTimeout(() => {
            const pending = this._pending.get(msg.id);
            if (pending) {
                this._pending.delete(msg.id);
                pending.reject(new Error(`Command ${commandType} timed out after ${timeout}ms`));
            }
        }, timeout);

        try {
            // Send the command
            await sendFunc(ws, msg.toDict());

            // Wait for response
            return await responsePromise;
        } finally {
            clearTimeout(timeoutId);
            this._pending.delete(msg.id);
        }
    }

    /**
     * Handle a potential response message.
     *
     * @param msg - Message that might be a response
     * @returns True if this was a response to a pending command
     */
    handleResponse(msg: MovesiaMessage): boolean {
        // Check if this is a response to a pending command
        // Responses typically have request_id in body
        const requestId = msg.body.request_id as string | undefined;

        if (!requestId) {
            return false;
        }

        const pending = this._pending.get(requestId);
        if (pending) {
            this._pending.delete(requestId);
            pending.resolve(msg.body);
            return true;
        }

        return false;
    }

    /**
     * Cancel all pending commands.
     */
    cancelAll(): void {
        for (const [_requestId, pending] of this._pending) {
            pending.reject(new Error('All commands cancelled'));
        }
        this._pending.clear();
    }
}
