/**
 * Custom LangGraph Checkpointer using sql.js
 *
 * This replaces better-sqlite3 with sql.js to avoid native module issues
 * in VS Code extensions. sql.js is a pure JavaScript/WASM implementation
 * of SQLite that works without native compilation.
 *
 * Based on the LangGraph SqliteSaver implementation:
 * https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint-sqlite/src/index.ts
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
    BaseCheckpointSaver,
    type Checkpoint,
    type CheckpointListOptions,
    type CheckpointTuple,
    type CheckpointMetadata,
    type PendingWrite,
    type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface CheckpointRow {
    thread_id: string;
    checkpoint_ns: string;
    checkpoint_id: string;
    parent_checkpoint_id: string | null;
    type: string;
    checkpoint: Uint8Array;
    metadata: Uint8Array;
}

interface WritesRow {
    thread_id: string;
    checkpoint_ns: string;
    checkpoint_id: string;
    task_id: string;
    idx: number;
    channel: string;
    type: string;
    value: Uint8Array;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SQL STATEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

const SETUP_CHECKPOINTS_TABLE = `
CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type TEXT,
    checkpoint BLOB,
    metadata BLOB,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
`;

const SETUP_WRITES_TABLE = `
CREATE TABLE IF NOT EXISTS checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT,
    value BLOB,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
`;

const UPSERT_CHECKPOINT = `
INSERT OR REPLACE INTO checkpoints
(thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
VALUES (?, ?, ?, ?, ?, ?, ?)
`;

const SELECT_CHECKPOINT = `
SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
FROM checkpoints
WHERE thread_id = ? AND checkpoint_ns = ?
ORDER BY checkpoint_id DESC
LIMIT 1
`;

const SELECT_CHECKPOINT_BY_ID = `
SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
FROM checkpoints
WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
`;

const SELECT_WRITES = `
SELECT thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value
FROM checkpoint_writes
WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
ORDER BY idx
`;

const UPSERT_WRITE = `
INSERT OR REPLACE INTO checkpoint_writes
(thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

const LIST_CHECKPOINTS = `
SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
FROM checkpoints
WHERE thread_id = ?
ORDER BY checkpoint_id DESC
`;

const DELETE_THREAD_CHECKPOINTS = `
DELETE FROM checkpoints WHERE thread_id = ?
`;

const DELETE_THREAD_WRITES = `
DELETE FROM checkpoint_writes WHERE thread_id = ?
`;

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKPOINTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SqlJsCheckpointer - A LangGraph checkpointer using sql.js (WASM SQLite)
 *
 * This provides persistent checkpoint storage without native module dependencies.
 *
 * @example
 * ```typescript
 * const checkpointer = await SqlJsCheckpointer.create('./data/checkpoints.db');
 * const agent = createReactAgent({
 *     llm,
 *     tools,
 *     checkpointSaver: checkpointer,
 * });
 * ```
 */
export class SqlJsCheckpointer extends BaseCheckpointSaver {
    private db: SqlJsDatabase;
    private dbPath: string | null;
    private isSetup: boolean = false;

    /**
     * Create a new SqlJsCheckpointer instance.
     * Use the static `create()` method to properly initialize.
     */
    private constructor(
        db: SqlJsDatabase,
        dbPath: string | null,
        serde?: SerializerProtocol
    ) {
        super(serde);
        this.db = db;
        this.dbPath = dbPath;
    }

    /**
     * Create and initialize a SqlJsCheckpointer.
     *
     * @param dbPath - Path to the SQLite database file. If null, uses in-memory database.
     * @param serde - Optional serializer protocol
     * @returns Initialized checkpointer
     */
    static async create(
        dbPath: string | null = null,
        serde?: SerializerProtocol
    ): Promise<SqlJsCheckpointer> {
        // Initialize sql.js
        const SQL = await initSqlJs();

        let db: SqlJsDatabase;

        if (dbPath && existsSync(dbPath)) {
            // Load existing database
            const buffer = readFileSync(dbPath);
            db = new SQL.Database(buffer);
        } else {
            // Create new database
            db = new SQL.Database();

            // Ensure directory exists if path specified
            if (dbPath) {
                const dir = dirname(dbPath);
                if (!existsSync(dir)) {
                    mkdirSync(dir, { recursive: true });
                }
            }
        }

        const checkpointer = new SqlJsCheckpointer(db, dbPath, serde);
        checkpointer.setup();

        return checkpointer;
    }

    /**
     * Create an in-memory checkpointer (no persistence).
     */
    static async createInMemory(serde?: SerializerProtocol): Promise<SqlJsCheckpointer> {
        return SqlJsCheckpointer.create(null, serde);
    }

    /**
     * Initialize database schema.
     */
    private setup(): void {
        if (this.isSetup) return;

        this.db.run(SETUP_CHECKPOINTS_TABLE);
        this.db.run(SETUP_WRITES_TABLE);
        this.isSetup = true;
    }

    /**
     * Save database to disk (if path was provided).
     */
    private persist(): void {
        if (this.dbPath) {
            const data = this.db.export();
            const buffer = Buffer.from(data);
            writeFileSync(this.dbPath, buffer);
        }
    }

    /**
     * Get a checkpoint tuple for the given configuration.
     */
    async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        this.setup();

        const threadId = config.configurable?.thread_id;
        const checkpointNs = config.configurable?.checkpoint_ns ?? '';
        const checkpointId = config.configurable?.checkpoint_id;

        if (!threadId) {
            return undefined;
        }

        let row: CheckpointRow | undefined;

        if (checkpointId) {
            // Get specific checkpoint
            const stmt = this.db.prepare(SELECT_CHECKPOINT_BY_ID);
            stmt.bind([threadId, checkpointNs, checkpointId]);
            if (stmt.step()) {
                const result = stmt.getAsObject() as unknown as CheckpointRow;
                row = result;
            }
            stmt.free();
        } else {
            // Get latest checkpoint
            const stmt = this.db.prepare(SELECT_CHECKPOINT);
            stmt.bind([threadId, checkpointNs]);
            if (stmt.step()) {
                const result = stmt.getAsObject() as unknown as CheckpointRow;
                row = result;
            }
            stmt.free();
        }

        if (!row) {
            return undefined;
        }

        // Get pending writes
        const pendingWrites: [string, string, unknown][] = [];
        const writesStmt = this.db.prepare(SELECT_WRITES);
        writesStmt.bind([threadId, checkpointNs, row.checkpoint_id]);
        while (writesStmt.step()) {
            const writeRow = writesStmt.getAsObject() as unknown as WritesRow;
            const value = await this.serde.loadsTyped(
                writeRow.type ?? 'json',
                writeRow.value
            );
            pendingWrites.push([writeRow.task_id, writeRow.channel, value]);
        }
        writesStmt.free();

        // Deserialize checkpoint and metadata
        const checkpoint = await this.serde.loadsTyped(
            row.type ?? 'json',
            row.checkpoint
        ) as Checkpoint;

        const metadata = await this.serde.loadsTyped(
            row.type ?? 'json',
            row.metadata
        ) as CheckpointMetadata;

        // Build config for this checkpoint
        const checkpointConfig: RunnableConfig = {
            configurable: {
                thread_id: row.thread_id,
                checkpoint_ns: row.checkpoint_ns,
                checkpoint_id: row.checkpoint_id,
            },
        };

        // Build parent config if exists
        let parentConfig: RunnableConfig | undefined;
        if (row.parent_checkpoint_id) {
            parentConfig = {
                configurable: {
                    thread_id: row.thread_id,
                    checkpoint_ns: row.checkpoint_ns,
                    checkpoint_id: row.parent_checkpoint_id,
                },
            };
        }

        return {
            config: checkpointConfig,
            checkpoint,
            metadata,
            parentConfig,
            pendingWrites,
        };
    }

    /**
     * List checkpoints matching the given configuration.
     */
    async *list(
        config: RunnableConfig,
        options?: CheckpointListOptions
    ): AsyncGenerator<CheckpointTuple> {
        this.setup();

        const threadId = config.configurable?.thread_id;
        if (!threadId) {
            return;
        }

        const limit = options?.limit;
        const before = options?.before;

        let sql = LIST_CHECKPOINTS;
        const params: (string | number)[] = [threadId];

        if (before?.configurable?.checkpoint_id) {
            sql = sql.replace(
                'ORDER BY',
                `AND checkpoint_id < ? ORDER BY`
            );
            params.push(before.configurable.checkpoint_id);
        }

        if (limit) {
            sql += ` LIMIT ${limit}`;
        }

        const stmt = this.db.prepare(sql);
        stmt.bind(params);

        let count = 0;
        while (stmt.step()) {
            if (limit && count >= limit) break;

            const row = stmt.getAsObject() as unknown as CheckpointRow;

            // Deserialize
            const checkpoint = await this.serde.loadsTyped(
                row.type ?? 'json',
                row.checkpoint
            ) as Checkpoint;

            const metadata = await this.serde.loadsTyped(
                row.type ?? 'json',
                row.metadata
            ) as CheckpointMetadata;

            const checkpointConfig: RunnableConfig = {
                configurable: {
                    thread_id: row.thread_id,
                    checkpoint_ns: row.checkpoint_ns,
                    checkpoint_id: row.checkpoint_id,
                },
            };

            let parentConfig: RunnableConfig | undefined;
            if (row.parent_checkpoint_id) {
                parentConfig = {
                    configurable: {
                        thread_id: row.thread_id,
                        checkpoint_ns: row.checkpoint_ns,
                        checkpoint_id: row.parent_checkpoint_id,
                    },
                };
            }

            yield {
                config: checkpointConfig,
                checkpoint,
                metadata,
                parentConfig,
            };

            count++;
        }
        stmt.free();
    }

    /**
     * Store a checkpoint.
     */
    async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata
    ): Promise<RunnableConfig> {
        this.setup();

        const threadId = config.configurable?.thread_id;
        const checkpointNs = config.configurable?.checkpoint_ns ?? '';
        const parentCheckpointId = config.configurable?.checkpoint_id;

        if (!threadId) {
            throw new Error('thread_id is required in config.configurable');
        }

        // Serialize checkpoint and metadata (async)
        const [type, serializedCheckpoint] = await this.serde.dumpsTyped(checkpoint);
        const [, serializedMetadata] = await this.serde.dumpsTyped(metadata);

        // Insert checkpoint
        this.db.run(UPSERT_CHECKPOINT, [
            threadId,
            checkpointNs,
            checkpoint.id,
            parentCheckpointId ?? null,
            type,
            serializedCheckpoint,
            serializedMetadata,
        ]);

        // Persist to disk
        this.persist();

        return {
            configurable: {
                thread_id: threadId,
                checkpoint_ns: checkpointNs,
                checkpoint_id: checkpoint.id,
            },
        };
    }

    /**
     * Store pending writes for a checkpoint.
     */
    async putWrites(
        config: RunnableConfig,
        writes: PendingWrite[],
        taskId: string
    ): Promise<void> {
        this.setup();

        const threadId = config.configurable?.thread_id;
        const checkpointNs = config.configurable?.checkpoint_ns ?? '';
        const checkpointId = config.configurable?.checkpoint_id;

        if (!threadId || !checkpointId) {
            throw new Error('thread_id and checkpoint_id are required in config.configurable');
        }

        // Insert each write
        for (let idx = 0; idx < writes.length; idx++) {
            const [channel, value] = writes[idx];
            const [type, serializedValue] = await this.serde.dumpsTyped(value);

            this.db.run(UPSERT_WRITE, [
                threadId,
                checkpointNs,
                checkpointId,
                taskId,
                idx,
                channel,
                type,
                serializedValue,
            ]);
        }

        // Persist to disk
        this.persist();
    }

    /**
     * Delete all checkpoints and writes for a thread.
     */
    async deleteThread(threadId: string): Promise<void> {
        this.setup();

        this.db.run(DELETE_THREAD_WRITES, [threadId]);
        this.db.run(DELETE_THREAD_CHECKPOINTS, [threadId]);

        this.persist();
    }

    /**
     * Close the database connection.
     */
    close(): void {
        this.persist();
        this.db.close();
    }
}

export default SqlJsCheckpointer;
