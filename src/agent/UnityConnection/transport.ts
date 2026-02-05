/**
 * Transport utilities for WebSocket message sending.
 *
 * Provides standardized message formatting and sending functions
 * to ensure consistent communication across all connections.
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { createLogger } from './config';
import { MovesiaMessage, ConnectionSource } from './types';

const logger = createLogger('movesia.transport');

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if data is already a valid Movesia message envelope.
 */
function isValidEnvelope(data: Record<string, unknown>): boolean {
    const required = ['v', 'source', 'type', 'ts', 'id'];
    return required.every(k => k in data);
}

// =============================================================================
// Core Send Functions
// =============================================================================

/**
 * Send a message to a WebSocket client.
 *
 * Wraps the message in the standard Movesia envelope if not already formatted.
 *
 * @param ws - WebSocket connection
 * @param message - Message to send (dict or MovesiaMessage)
 * @param source - Source identifier
 * @returns True if sent successfully, False otherwise
 */
export async function sendToClient(
    ws: WebSocket,
    message: Record<string, unknown>,
    source: ConnectionSource = ConnectionSource.VSCODE
): Promise<boolean> {
    try {
        let envelope: Record<string, unknown>;

        // Check if already a properly formatted envelope
        if (isValidEnvelope(message)) {
            envelope = message;
        } else {
            // Wrap in envelope
            const msg = MovesiaMessage.create(
                (message.type as string) ?? 'message',
                (message.body as Record<string, unknown>) ?? message,
                source,
                message.session as string | undefined
            );
            envelope = msg.toDict();
        }

        return new Promise((resolve) => {
            ws.send(JSON.stringify(envelope), (error) => {
                if (error) {
                    logger.error('Failed to send message', error);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    } catch (error) {
        logger.error('Failed to send message', error as Error);
        return false;
    }
}

/**
 * Send a typed message to a WebSocket client.
 *
 * Convenience function for sending messages with explicit type and body.
 *
 * @param ws - WebSocket connection
 * @param msgType - Message type
 * @param body - Message body
 * @param session - Optional session identifier
 * @param source - Source identifier
 * @returns True if sent successfully
 */
export async function sendMessage(
    ws: WebSocket,
    msgType: string,
    body: Record<string, unknown>,
    session?: string,
    source: ConnectionSource = ConnectionSource.VSCODE
): Promise<boolean> {
    const msg = MovesiaMessage.create(msgType, body, source, session);
    return sendToClient(ws, msg.toDict());
}

/**
 * Send welcome message to a newly connected client.
 *
 * @param ws - WebSocket connection
 * @param extraInfo - Additional info to include in welcome
 * @returns True if sent successfully
 */
export async function sendWelcome(
    ws: WebSocket,
    extraInfo?: Record<string, unknown>
): Promise<boolean> {
    const body = {
        message: 'Connected to Movesia Agent Server',
        ...extraInfo
    };
    return sendMessage(ws, 'welcome', body);
}

/**
 * Send error message to client.
 *
 * @param ws - WebSocket connection
 * @param errorMessage - Human-readable error message
 * @param errorCode - Machine-readable error code
 * @param requestId - ID of request that caused error
 * @returns True if sent successfully
 */
export async function sendError(
    ws: WebSocket,
    errorMessage: string,
    errorCode?: string,
    requestId?: string
): Promise<boolean> {
    const body: Record<string, unknown> = { error: errorMessage };
    if (errorCode) body.error_code = errorCode;
    if (requestId) body.request_id = requestId;
    return sendMessage(ws, 'error', body);
}

/**
 * Send acknowledgment for a received message.
 *
 * @param ws - WebSocket connection
 * @param msgId - ID of message being acknowledged
 * @returns True if sent successfully
 */
export async function sendAck(ws: WebSocket, msgId: string): Promise<boolean> {
    const msg = MovesiaMessage.create('ack', {}, ConnectionSource.VSCODE);
    msg.id = msgId;  // Use original message ID
    return sendToClient(ws, msg.toDict());
}

/**
 * Send application-level ping.
 *
 * @param ws - WebSocket connection
 * @param pingId - Optional ping ID (auto-generated if not provided)
 * @returns Ping ID if sent successfully, undefined otherwise
 */
export async function sendPing(
    ws: WebSocket,
    pingId?: string
): Promise<string | undefined> {
    const id = pingId ?? randomUUID();

    const msg = MovesiaMessage.create('hb', {}, ConnectionSource.VSCODE);
    msg.id = id;

    if (await sendToClient(ws, msg.toDict())) {
        return id;
    }
    return undefined;
}

/**
 * Send a command to Unity.
 *
 * @param ws - WebSocket connection
 * @param commandType - Type of command
 * @param requestId - Request ID for response correlation
 * @param params - Command parameters
 * @returns True if sent successfully
 */
export async function sendCommand(
    ws: WebSocket,
    commandType: string,
    requestId: string,
    params: Record<string, unknown> = {}
): Promise<boolean> {
    const body = {
        request_id: requestId,
        ...params
    };
    return sendMessage(ws, commandType, body);
}

/**
 * Broadcast message to multiple WebSocket connections.
 *
 * @param websockets - List of WebSocket connections
 * @param msgType - Message type
 * @param body - Message body
 * @param exclude - Set of WebSocket objects to exclude
 * @returns Number of successful sends
 */
export async function broadcast(
    websockets: WebSocket[],
    msgType: string,
    body: Record<string, unknown>,
    exclude?: Set<WebSocket>
): Promise<number> {
    const excludeSet = exclude ?? new Set();
    let sentCount = 0;

    const promises = websockets
        .filter(ws => !excludeSet.has(ws))
        .map(async ws => {
            if (await sendMessage(ws, msgType, body)) {
                sentCount++;
            }
        });

    await Promise.all(promises);

    logger.debug(`Broadcast '${msgType}' to ${sentCount}/${websockets.length} clients`);
    return sentCount;
}

// =============================================================================
// Message Queue
// =============================================================================

/**
 * Queue for outgoing messages with batching and retry support.
 *
 * Useful for high-throughput scenarios where messages need to be
 * batched or retried on failure.
 */
export class MessageQueue {
    private _queue: Array<{ ws: WebSocket; message: Record<string, unknown> }> = [];
    private _maxSize: number;
    private _batchSize: number;
    private _batchDelay: number;
    private _running = false;
    private _intervalId?: NodeJS.Timeout;

    constructor(options: {
        maxSize?: number;
        batchSize?: number;
        batchDelay?: number;
    } = {}) {
        this._maxSize = options.maxSize ?? 1000;
        this._batchSize = options.batchSize ?? 10;
        this._batchDelay = options.batchDelay ?? 100;
    }

    /**
     * Add message to the queue.
     *
     * @param ws - Target WebSocket
     * @param message - Message to send
     * @returns True if queued, False if queue is full
     */
    enqueue(ws: WebSocket, message: Record<string, unknown>): boolean {
        if (this._queue.length >= this._maxSize) {
            logger.warn('Message queue full, dropping message');
            return false;
        }
        this._queue.push({ ws, message });
        return true;
    }

    /**
     * Start the queue processor.
     */
    start(sendFunc: (ws: WebSocket, message: Record<string, unknown>) => Promise<void>): void {
        if (this._running) {
            return;
        }

        this._running = true;
        this._intervalId = setInterval(async () => {
            await this._processBatch(sendFunc);
        }, this._batchDelay);
    }

    /**
     * Stop the queue processor.
     */
    stop(): void {
        this._running = false;
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = undefined;
        }
    }

    /**
     * Process a batch of messages.
     */
    private async _processBatch(
        sendFunc: (ws: WebSocket, message: Record<string, unknown>) => Promise<void>
    ): Promise<void> {
        if (this._queue.length === 0) {
            return;
        }

        const batch = this._queue.splice(0, this._batchSize);

        for (const { ws, message } of batch) {
            try {
                await sendFunc(ws, message);
            } catch (error) {
                logger.error('Failed to send queued message', error as Error);
            }
        }
    }
}

// =============================================================================
// Reliable Transport
// =============================================================================

/**
 * Transport with delivery confirmation and retry.
 *
 * Tracks ACKs for messages that require confirmation and
 * retries on timeout.
 */
export class ReliableTransport {
    private _ackTimeout: number;
    private _maxRetries: number;
    private _retryDelay: number;
    private _pending: Map<string, {
        resolve: () => void;
        reject: (error: Error) => void;
    }> = new Map();

    constructor(options: {
        ackTimeout?: number;
        maxRetries?: number;
        retryDelay?: number;
    } = {}) {
        this._ackTimeout = options.ackTimeout ?? 5000;
        this._maxRetries = options.maxRetries ?? 3;
        this._retryDelay = options.retryDelay ?? 1000;
    }

    /**
     * Send message with delivery confirmation.
     *
     * @param ws - WebSocket connection
     * @param msgType - Message type
     * @param body - Message body
     * @returns True if ACK received, False otherwise
     */
    async sendReliable(
        ws: WebSocket,
        msgType: string,
        body: Record<string, unknown>
    ): Promise<boolean> {
        const msg = MovesiaMessage.create(msgType, body, ConnectionSource.VSCODE);

        for (let attempt = 0; attempt < this._maxRetries; attempt++) {
            try {
                // Create promise for ACK
                const ackPromise = new Promise<void>((resolve, reject) => {
                    this._pending.set(msg.id, { resolve, reject });
                });

                // Set up timeout
                const timeoutId = setTimeout(() => {
                    const pending = this._pending.get(msg.id);
                    if (pending) {
                        this._pending.delete(msg.id);
                        pending.reject(new Error('ACK timeout'));
                    }
                }, this._ackTimeout);

                // Send message
                await sendToClient(ws, msg.toDict());

                // Wait for ACK
                await ackPromise;
                clearTimeout(timeoutId);
                return true;

            } catch (error) {
                this._pending.delete(msg.id);
                logger.warn(
                    `No ACK for message ${msg.id}, attempt ${attempt + 1}/${this._maxRetries}`
                );

                if (attempt < this._maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, this._retryDelay));
                }
            }
        }

        return false;
    }

    /**
     * Handle received ACK.
     *
     * @param msgId - ID of acknowledged message
     * @returns True if this was a pending ACK
     */
    handleAck(msgId: string): boolean {
        const pending = this._pending.get(msgId);
        if (pending) {
            this._pending.delete(msgId);
            pending.resolve();
            return true;
        }
        return false;
    }
}
