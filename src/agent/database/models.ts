/**
 * Database models for Movesia Agent.
 *
 * Only stores thread/conversation metadata.
 * Messages and tool executions are automatically handled by LangGraph's checkpointer.
 */

import { randomUUID } from 'crypto';

/**
 * Generate a new UUID string.
 */
export function generateUuid(): string {
    return randomUUID();
}

/**
 * Conversation metadata interface.
 *
 * The actual messages are stored by LangGraph's checkpointer.
 * This interface only stores metadata for listing/searching threads.
 */
export interface Conversation {
    id: string;
    sessionId: string;

    // Metadata
    title: string | null;
    unityProjectPath: string | null;
    unityVersion: string | null;

    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Create a new conversation with default values.
 */
export function createConversation(
    sessionId: string,
    options: {
        title?: string | null;
        unityProjectPath?: string | null;
        unityVersion?: string | null;
    } = {}
): Conversation {
    const now = new Date();
    return {
        id: generateUuid(),
        sessionId,
        title: options.title ?? null,
        unityProjectPath: options.unityProjectPath ?? null,
        unityVersion: options.unityVersion ?? null,
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * SQL schema for the conversations table.
 */
export const CONVERSATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    title TEXT,
    unity_project_path TEXT,
    unity_version TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
`;

/**
 * Convert a database row to a Conversation object.
 */
export function rowToConversation(row: Record<string, unknown>): Conversation {
    return {
        id: row.id as string,
        sessionId: row.session_id as string,
        title: row.title as string | null,
        unityProjectPath: row.unity_project_path as string | null,
        unityVersion: row.unity_version as string | null,
        createdAt: new Date(row.created_at as string),
        updatedAt: new Date(row.updated_at as string),
    };
}

/**
 * Convert a Conversation object to database row values.
 */
export function conversationToRow(conv: Conversation): Record<string, unknown> {
    return {
        id: conv.id,
        session_id: conv.sessionId,
        title: conv.title,
        unity_project_path: conv.unityProjectPath,
        unity_version: conv.unityVersion,
        created_at: conv.createdAt.toISOString(),
        updated_at: conv.updatedAt.toISOString(),
    };
}
