/**
 * Database repository for conversation metadata.
 *
 * Uses sql.js (WASM SQLite) for database operations.
 * Messages and tool executions are handled by LangGraph's checkpointer.
 * This only manages thread/conversation metadata for listing and search.
 */

import { createLogger } from '../UnityConnection/config';
import { getDatabase, saveDatabase } from './engine';
import {
    type Conversation,
    createConversation,
    rowToConversation,
} from './models';

const logger = createLogger('movesia.database');

/**
 * Execute a query and return all results as objects.
 */
function queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
    const db = getDatabase();
    const stmt = db.prepare(sql);
    stmt.bind(params);

    const results: Record<string, unknown>[] = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject() as Record<string, unknown>);
    }
    stmt.free();

    return results;
}

/**
 * Execute a query and return the first result as an object.
 */
function queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
    const db = getDatabase();
    const stmt = db.prepare(sql);
    stmt.bind(params);

    let result: Record<string, unknown> | undefined;
    if (stmt.step()) {
        result = stmt.getAsObject() as Record<string, unknown>;
    }
    stmt.free();

    return result;
}

/**
 * Execute a SQL statement (INSERT, UPDATE, DELETE).
 */
function execute(sql: string, params: unknown[] = []): void {
    const db = getDatabase();
    db.run(sql, params);
    saveDatabase();
}

/**
 * Repository for conversation metadata operations.
 */
export class ConversationRepository {
    /**
     * Get an existing conversation or create a new one.
     *
     * Called when a chat session starts to ensure we have metadata.
     */
    async getOrCreate(
        sessionId: string,
        options: {
            unityProjectPath?: string | null;
            unityVersion?: string | null;
        } = {}
    ): Promise<Conversation> {
        // Try to get existing
        const existing = queryOne(
            'SELECT * FROM conversations WHERE session_id = ?',
            [sessionId]
        );

        if (existing) {
            // Update metadata if provided
            const updates: string[] = [];
            const values: unknown[] = [];

            if (options.unityProjectPath && !existing.unity_project_path) {
                updates.push('unity_project_path = ?');
                values.push(options.unityProjectPath);
            }
            if (options.unityVersion && !existing.unity_version) {
                updates.push('unity_version = ?');
                values.push(options.unityVersion);
            }

            if (updates.length > 0) {
                updates.push('updated_at = ?');
                values.push(new Date().toISOString());
                values.push(sessionId);

                execute(
                    `UPDATE conversations SET ${updates.join(', ')} WHERE session_id = ?`,
                    values
                );
            }

            return rowToConversation(existing);
        }

        // Create new
        const conversation = createConversation(sessionId, {
            unityProjectPath: options.unityProjectPath,
            unityVersion: options.unityVersion,
        });

        execute(`
            INSERT INTO conversations (id, session_id, title, unity_project_path, unity_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            conversation.id,
            conversation.sessionId,
            conversation.title,
            conversation.unityProjectPath,
            conversation.unityVersion,
            conversation.createdAt.toISOString(),
            conversation.updatedAt.toISOString()
        ]);

        logger.info(`Created conversation: ${conversation.id.slice(0, 8)} for session ${sessionId.slice(0, 8)}`);
        return conversation;
    }

    /**
     * Get a conversation by session_id.
     */
    async get(sessionId: string): Promise<Conversation | null> {
        const row = queryOne(
            'SELECT * FROM conversations WHERE session_id = ?',
            [sessionId]
        );

        return row ? rowToConversation(row) : null;
    }

    /**
     * List conversations, ordered by most recently updated.
     */
    async listAll(limit: number = 50, offset: number = 0): Promise<Conversation[]> {
        const rows = queryAll(`
            SELECT * FROM conversations
            ORDER BY updated_at DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);

        return rows.map(rowToConversation);
    }

    /**
     * Update conversation title (auto-generated from first user message).
     */
    async updateTitle(sessionId: string, title: string): Promise<void> {
        execute(`
            UPDATE conversations
            SET title = ?, updated_at = ?
            WHERE session_id = ?
        `, [title.slice(0, 500), new Date().toISOString(), sessionId]);
    }

    /**
     * Update the updated_at timestamp (call on each message).
     */
    async touch(sessionId: string): Promise<void> {
        execute(`
            UPDATE conversations
            SET updated_at = ?
            WHERE session_id = ?
        `, [new Date().toISOString(), sessionId]);
    }

    /**
     * Delete a conversation. Returns true if deleted.
     */
    async delete(sessionId: string): Promise<boolean> {
        const before = queryOne(
            'SELECT COUNT(*) as count FROM conversations WHERE session_id = ?',
            [sessionId]
        );
        const countBefore = (before?.count as number) ?? 0;

        execute(
            'DELETE FROM conversations WHERE session_id = ?',
            [sessionId]
        );

        const after = queryOne(
            'SELECT COUNT(*) as count FROM conversations WHERE session_id = ?',
            [sessionId]
        );
        const countAfter = (after?.count as number) ?? 0;

        return countBefore > countAfter;
    }

    /**
     * Count total conversations.
     */
    async count(): Promise<number> {
        const result = queryOne(
            'SELECT COUNT(*) as count FROM conversations'
        );

        return (result?.count as number) ?? 0;
    }

    /**
     * Search conversations by title.
     */
    async search(query: string, limit: number = 20): Promise<Conversation[]> {
        const rows = queryAll(`
            SELECT * FROM conversations
            WHERE title LIKE ?
            ORDER BY updated_at DESC
            LIMIT ?
        `, [`%${query}%`, limit]);

        return rows.map(rowToConversation);
    }
}

// Global repository instance
let _repository: ConversationRepository | null = null;

/**
 * Get the global repository instance.
 */
export function getRepository(): ConversationRepository {
    if (_repository === null) {
        _repository = new ConversationRepository();
    }
    return _repository;
}
