/**
 * Type definitions for WebSocket connection management.
 *
 * Mirrors the well-structured Python types for consistency across the stack.
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';

// =============================================================================
// Enums
// =============================================================================

/** Source of the WebSocket connection. */
export enum ConnectionSource {
    UNITY = 'unity',
    VSCODE = 'vscode',
    ELECTRON = 'electron'
}

/** State of a WebSocket connection. */
export enum ConnectionState {
    CONNECTING = 'connecting',
    OPEN = 'open',
    CLOSING = 'closing',
    CLOSED = 'closed'
}

// =============================================================================
// Message Types
// =============================================================================

/** Zod schema for MovesiaMessage validation */
export const MovesiaMessageSchema = z.object({
    v: z.number().int().default(1),
    source: z.nativeEnum(ConnectionSource),
    type: z.string(),
    ts: z.number().int(),
    id: z.string(),
    body: z.record(z.string(), z.unknown()).default({}),
    session: z.string().optional()
});

/** Type inferred from MovesiaMessage schema */
export type MovesiaMessageData = z.infer<typeof MovesiaMessageSchema>;

/**
 * Standardized message envelope for all WebSocket communication.
 *
 * Matches the Python MovesiaMessage dataclass for cross-platform consistency.
 */
export class MovesiaMessage {
    v: number;
    source: ConnectionSource;
    type: string;
    ts: number;
    id: string;
    body: Record<string, unknown>;
    session?: string;

    constructor(data: MovesiaMessageData) {
        this.v = data.v;
        this.source = data.source;
        this.type = data.type;
        this.ts = data.ts;
        this.id = data.id;
        this.body = data.body;
        this.session = data.session;
    }

    /**
     * Factory method to create a new message with auto-generated ID and timestamp.
     */
    static create(
        msgType: string,
        body: Record<string, unknown> = {},
        source: ConnectionSource = ConnectionSource.VSCODE,
        session?: string
    ): MovesiaMessage {
        const id = randomUUID();
        return new MovesiaMessage({
            v: 1,
            source,
            type: msgType,
            ts: Math.floor(Date.now() / 1000),
            id,
            body,
            session
        });
    }

    /**
     * Convert to dictionary for JSON serialization.
     */
    toDict(): Record<string, unknown> {
        const result: Record<string, unknown> = {
            v: this.v,
            source: this.source,
            type: this.type,
            ts: this.ts,
            id: this.id,
            body: this.body
        };
        if (this.session) {
            result.session = this.session;
        }
        return result;
    }

    /**
     * Create from dictionary (e.g., parsed JSON).
     */
    static fromDict(data: Record<string, unknown>): MovesiaMessage {
        let source = data.source as string;
        if (!Object.values(ConnectionSource).includes(source as ConnectionSource)) {
            source = ConnectionSource.UNITY;
        }

        return new MovesiaMessage({
            v: (data.v as number) ?? 1,
            source: source as ConnectionSource,
            type: (data.type as string) ?? 'unknown',
            ts: (data.ts as number) ?? Math.floor(Date.now() / 1000),
            id: (data.id as string) ?? '',
            body: (data.body as Record<string, unknown>) ?? {},
            session: data.session as string | undefined
        });
    }
}

// =============================================================================
// Connection Types
// =============================================================================

/**
 * Extended connection metadata tracking.
 *
 * Stores all relevant state for a WebSocket connection including
 * health monitoring, session binding, and lifecycle tracking.
 */
export interface ExtendedConnection {
    cid: string;                      // Connection ID (short random identifier)
    session?: string;
    projectPath?: string;
    connSeq: number;                  // Connection sequence for monotonic takeover

    // Health tracking
    isAlive: boolean;
    missedPongs: number;
    lastSeen: number;                 // Unix timestamp
    lastPingSent?: number;
    latencyMs?: number;

    // Lifecycle tracking
    connectedAt: number;              // Unix timestamp
    closingSince?: number;
    state: ConnectionState;

    // Unity-specific
    unityVersion?: string;
    isCompiling: boolean;
}

/**
 * Create a new ExtendedConnection with default values.
 */
export function createExtendedConnection(
    cid: string,
    options: Partial<ExtendedConnection> = {}
): ExtendedConnection {
    const now = Date.now() / 1000;
    return {
        cid,
        session: options.session,
        projectPath: options.projectPath,
        connSeq: options.connSeq ?? 0,
        isAlive: true,
        missedPongs: 0,
        lastSeen: now,
        lastPingSent: undefined,
        latencyMs: undefined,
        connectedAt: now,
        closingSince: undefined,
        state: ConnectionState.CONNECTING,
        unityVersion: options.unityVersion,
        isCompiling: false
    };
}

/**
 * Update last seen timestamp and reset health counters.
 */
export function updateConnectionSeen(conn: ExtendedConnection): void {
    conn.lastSeen = Date.now() / 1000;
    conn.isAlive = true;
    conn.missedPongs = 0;
}

/**
 * Record pong receipt and calculate latency.
 */
export function markPongReceived(conn: ExtendedConnection, pingTime: number): void {
    conn.isAlive = true;
    conn.missedPongs = 0;
    conn.lastSeen = Date.now() / 1000;
    if (pingTime) {
        conn.latencyMs = (Date.now() / 1000 - pingTime) * 1000;
    }
}

/**
 * Record that a ping was sent.
 */
export function markPingSent(conn: ExtendedConnection): void {
    conn.lastPingSent = Date.now() / 1000;
}

/**
 * Get connection age in seconds.
 */
export function connectionAge(conn: ExtendedConnection): number {
    return Date.now() / 1000 - conn.connectedAt;
}

/**
 * Get idle time since last activity.
 */
export function connectionIdleTime(conn: ExtendedConnection): number {
    return Date.now() / 1000 - conn.lastSeen;
}

// =============================================================================
// Session Types
// =============================================================================

/** Entry in the session manager tracking active sessions. */
export interface SessionEntry {
    sessionId: string;
    connSeq: number;
    connection: ExtendedConnection;
    websocket: WebSocket;  // ws package WebSocket
    createdAt: number;
}

// =============================================================================
// Configuration Types
// =============================================================================

/** Configuration for heartbeat/keepalive behavior. */
export interface HeartbeatConfig {
    sweepIntervalMs: number;         // How often to check connections (default: 40000)
    pingAfterIdleMs: number;         // Send ping after this idle time (default: 90000)
    maxIdleMs: number;               // Disconnect after this (default: 600000 = 10 min)
    pongTimeoutMs: number;           // Wait this long for pong (default: 20000)
    maxMissedPongs: number;          // Disconnect after this many missed (default: 3)
    closingForceKillMs: number;      // Force kill stuck closing connections (default: 10000)

    // Compilation-aware settings
    compileSuspendMs: number;        // Suspend during compilation (default: 120000)
    postCompileGraceMs: number;      // Grace period after compilation (default: 30000)
}

/** Default heartbeat configuration. */
export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
    sweepIntervalMs: 40_000,
    pingAfterIdleMs: 90_000,
    maxIdleMs: 600_000,
    pongTimeoutMs: 20_000,
    maxMissedPongs: 3,
    closingForceKillMs: 10_000,
    compileSuspendMs: 120_000,
    postCompileGraceMs: 30_000
};

/** Configuration for the Unity manager. */
export interface UnityManagerConfig {
    handshakeTimeout: number;        // Seconds (default: 10.0)
    commandTimeout: number;          // Seconds (default: 30.0)
    interruptTimeout: number;        // Seconds (default: 120.0)
    reconnectGracePeriod: number;    // Seconds (default: 5.0)
    maxPendingCommands: number;      // Default: 100
    heartbeat: HeartbeatConfig;
}

/** Default Unity manager configuration. */
export const DEFAULT_UNITY_MANAGER_CONFIG: UnityManagerConfig = {
    handshakeTimeout: 10.0,
    commandTimeout: 30.0,
    interruptTimeout: 120.0,
    reconnectGracePeriod: 5.0,
    maxPendingCommands: 100,
    heartbeat: DEFAULT_HEARTBEAT_CONFIG
};

// =============================================================================
// Constants
// =============================================================================

/** Message types that should receive ACK. */
export const ACK_REQUIRED_TYPES = new Set([
    'hello',
    'assets_imported',
    'assets_deleted',
    'assets_moved',
    'scene_saved',
    'project_changed',
    'compile_started',
    'compile_finished',
    'will_save_assets',
    'hierarchy_changed',
    'selection_changed'
]);

/** WebSocket close codes (standard + custom). */
export const CloseCode = {
    NORMAL: 1000,
    GOING_AWAY: 1001,
    PROTOCOL_ERROR: 1002,
    UNSUPPORTED: 1003,
    NO_STATUS: 1005,
    ABNORMAL: 1006,
    INVALID_DATA: 1007,
    POLICY_VIOLATION: 1008,
    MESSAGE_TOO_BIG: 1009,
    EXTENSION_REQUIRED: 1010,
    INTERNAL_ERROR: 1011,
    SERVICE_RESTART: 1012,
    TRY_AGAIN_LATER: 1013,

    // Custom codes (4000-4999)
    SUPERSEDED: 4001,                // Connection superseded by newer one
    DUPLICATE_SESSION: 4002,
    AUTHENTICATION_FAILED: 4003,
    SESSION_EXPIRED: 4004,
    COMPILATION_RESET: 4005,
    PROJECT_MISMATCH: 4006,              // Connection rejected: wrong Unity project
} as const;

/** Standard message types. */
export const MessageType = {
    // Control messages
    HELLO: 'hello',
    WELCOME: 'welcome',
    ACK: 'ack',
    ERROR: 'error',
    HEARTBEAT: 'hb',
    PONG: 'pong',

    // Lifecycle events
    CONNECTION_ESTABLISHED: 'connection_established',
    COMPILE_STARTED: 'compile_started',
    COMPILE_FINISHED: 'compile_finished',

    // Unity events
    HIERARCHY_CHANGED: 'hierarchy_changed',
    SELECTION_CHANGED: 'selection_changed',
    SCENE_SAVED: 'scene_saved',
    PROJECT_CHANGED: 'project_changed',
    ASSETS_IMPORTED: 'assets_imported',
    ASSETS_DELETED: 'assets_deleted',
    ASSETS_MOVED: 'assets_moved',

    // Commands
    QUERY_HIERARCHY: 'query_hierarchy',
    GET_COMPONENT: 'get_component',
    SET_PROPERTY: 'set_property',
    CREATE_OBJECT: 'create_object',
    DELETE_OBJECT: 'delete_object'
} as const;

// =============================================================================
// Callback Types
// =============================================================================

/** Callback for connection state changes. */
export type OnConnectionChange = (connected: boolean) => Promise<void>;

/** Callback for domain events. */
export type OnDomainEvent = (msg: MovesiaMessage) => Promise<void>;
