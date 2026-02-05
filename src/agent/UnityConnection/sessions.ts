/**
 * Session Manager for WebSocket connections.
 *
 * Implements monotonic takeover pattern where newer connections (higher connSeq)
 * automatically supersede older connections for the same session.
 *
 * This prevents issues with:
 * - Stale connections after network interruption
 * - Unity domain reload creating new connections
 * - Browser/client refresh while old connection lingers
 */

import { WebSocket } from 'ws';
import {
    ExtendedConnection,
    SessionEntry,
    ConnectionState,
    updateConnectionSeen
} from './types';

// =============================================================================
// Accept Decision
// =============================================================================

/** Result of session acceptance decision. */
export interface AcceptDecision {
    accept: boolean;
    supersede?: WebSocket;  // WebSocket to close
    reason?: string;
}

// =============================================================================
// Session Manager
// =============================================================================

/**
 * Manages WebSocket sessions with monotonic takeover support.
 *
 * Key behaviors:
 * - Each session (identified by sessionId) can have at most one active connection
 * - Newer connections (higher connSeq) automatically supersede older ones
 * - Older connection attempts are rejected immediately
 * - Clean tracking and cleanup of session state
 */
export class SessionManager {
    protected _sessions: Map<string, SessionEntry> = new Map();

    /**
     * Evaluate whether to accept a new connection.
     *
     * @param sessionId - Unique session identifier
     * @param connSeq - Connection sequence number (monotonically increasing)
     * @param connection - Extended connection metadata
     * @param websocket - The WebSocket object
     * @returns AcceptDecision with accept=true and optionally a websocket to supersede,
     *          or accept=false if connection should be rejected.
     */
    async accept(
        sessionId: string,
        connSeq: number,
        connection: ExtendedConnection,
        websocket: WebSocket
    ): Promise<AcceptDecision> {
        const existing = this._sessions.get(sessionId);

        // No existing session - accept immediately
        if (!existing) {
            this._sessions.set(sessionId, {
                sessionId,
                connSeq,
                connection,
                websocket,
                createdAt: Date.now() / 1000
            });
            return { accept: true };
        }

        // Existing session with same or higher connSeq - reject
        if (connSeq <= existing.connSeq) {
            return {
                accept: false,
                reason: `Connection sequence ${connSeq} <= current ${existing.connSeq}`
            };
        }

        // Newer connection - supersede the old one
        const oldWebsocket = existing.websocket;

        // Update the session entry
        this._sessions.set(sessionId, {
            sessionId,
            connSeq,
            connection,
            websocket,
            createdAt: Date.now() / 1000
        });

        return { accept: true, supersede: oldWebsocket };
    }

    /**
     * Clear session entry only if the websocket matches.
     *
     * This prevents accidentally clearing a session that was
     * already superseded by a newer connection.
     *
     * @param sessionId - Session to potentially clear
     * @param websocket - WebSocket that must match
     * @returns True if session was cleared, False otherwise
     */
    async clearIfMatch(sessionId: string, websocket: WebSocket): Promise<boolean> {
        const entry = this._sessions.get(sessionId);
        if (entry && entry.websocket === websocket) {
            this._sessions.delete(sessionId);
            return true;
        }
        return false;
    }

    /**
     * Get session entry by ID.
     */
    async getSession(sessionId: string): Promise<SessionEntry | undefined> {
        return this._sessions.get(sessionId);
    }

    /**
     * Get connection metadata for a session.
     */
    async getConnection(sessionId: string): Promise<ExtendedConnection | undefined> {
        const entry = await this.getSession(sessionId);
        return entry?.connection;
    }

    /**
     * Get WebSocket for a session.
     */
    async getWebsocket(sessionId: string): Promise<WebSocket | undefined> {
        const entry = await this.getSession(sessionId);
        return entry?.websocket;
    }

    /**
     * Update connection metadata for a session.
     *
     * @param sessionId - Session to update
     * @param updates - Fields to update on the ExtendedConnection
     * @returns True if session existed and was updated
     */
    async updateConnection(
        sessionId: string,
        updates: Partial<ExtendedConnection>
    ): Promise<boolean> {
        const entry = this._sessions.get(sessionId);
        if (!entry) {
            return false;
        }

        Object.assign(entry.connection, updates);
        return true;
    }

    /**
     * Mark session as having recent activity.
     */
    async markSeen(sessionId: string): Promise<boolean> {
        const entry = this._sessions.get(sessionId);
        if (entry) {
            updateConnectionSeen(entry.connection);
            return true;
        }
        return false;
    }

    /**
     * Get all active sessions (for iteration).
     */
    async getAllSessions(): Promise<Map<string, SessionEntry>> {
        return new Map(this._sessions);
    }

    /**
     * Get all active WebSocket connections.
     */
    async getActiveWebsockets(): Promise<WebSocket[]> {
        const websockets: WebSocket[] = [];
        for (const entry of this._sessions.values()) {
            if (entry.connection.state === ConnectionState.OPEN) {
                websockets.push(entry.websocket);
            }
        }
        return websockets;
    }

    /**
     * Number of active sessions.
     */
    get size(): number {
        return this._sessions.size;
    }

    /**
     * Clear all sessions. Returns count of cleared sessions.
     */
    async clearAll(): Promise<number> {
        const count = this._sessions.size;
        this._sessions.clear();
        return count;
    }
}

// =============================================================================
// Unity Session Manager
// =============================================================================

/**
 * Extended session manager with Unity-specific functionality.
 *
 * Adds:
 * - Project path tracking
 * - Compilation state management
 * - Unity version tracking
 */
export class UnitySessionManager extends SessionManager {
    private _projectToSession: Map<string, string> = new Map();  // projectPath -> sessionId

    /**
     * Accept with optional project path tracking.
     */
    async accept(
        sessionId: string,
        connSeq: number,
        connection: ExtendedConnection,
        websocket: WebSocket,
        projectPath?: string
    ): Promise<AcceptDecision> {
        const decision = await super.accept(sessionId, connSeq, connection, websocket);

        if (decision.accept && projectPath) {
            this._projectToSession.set(projectPath, sessionId);
            connection.projectPath = projectPath;
        }

        return decision;
    }

    /**
     * Get session by Unity project path.
     */
    async getSessionForProject(projectPath: string): Promise<SessionEntry | undefined> {
        const sessionId = this._projectToSession.get(projectPath);
        if (sessionId) {
            return this._sessions.get(sessionId);
        }
        return undefined;
    }

    /**
     * Update compilation state for a session.
     */
    async setCompiling(sessionId: string, isCompiling: boolean): Promise<boolean> {
        return this.updateConnection(sessionId, { isCompiling });
    }

    /**
     * Clear with project path cleanup.
     */
    async clearIfMatch(sessionId: string, websocket: WebSocket): Promise<boolean> {
        const entry = this._sessions.get(sessionId);
        if (entry && entry.websocket === websocket) {
            // Clean up project mapping
            if (entry.connection.projectPath) {
                this._projectToSession.delete(entry.connection.projectPath);
            }

            this._sessions.delete(sessionId);
            return true;
        }
        return false;
    }

    /**
     * Get all sessions currently in compilation state.
     */
    async getCompilingSessions(): Promise<SessionEntry[]> {
        const compiling: SessionEntry[] = [];
        for (const entry of this._sessions.values()) {
            if (entry.connection.isCompiling) {
                compiling.push(entry);
            }
        }
        return compiling;
    }
}
