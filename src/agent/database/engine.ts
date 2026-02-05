/**
 * Database engine and connection management using sql.js.
 *
 * Uses sql.js (WASM SQLite) instead of better-sqlite3 to avoid
 * native module compilation issues in VS Code extensions.
 *
 * Single SQLite database for:
 * - Conversation metadata (our table)
 * - LangGraph checkpoints (SqlJsCheckpointer tables)
 *
 * This module is designed to run inside the VS Code extension process.
 * Database path is set dynamically from VS Code's globalStorageUri.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { createLogger } from '../UnityConnection/config';
import { CONVERSATIONS_SCHEMA } from './models';
import { SqlJsCheckpointer } from './SqlJsCheckpointer';

const logger = createLogger('movesia.database');

// Global instances (initialized during startup)
let _db: SqlJsDatabase | null = null;
let _checkpointSaver: SqlJsCheckpointer | null = null;
let _sqlJs: Awaited<ReturnType<typeof initSqlJs>> | null = null;

// Database path - set from VS Code extension context
let _storagePath: string | null = null;
let _dbPath: string | null = null;

/**
 * Set the storage path from VS Code's globalStorageUri.
 * Call this from the extension before initializing the database.
 */
export function setStoragePath(path: string): void {
    _storagePath = path;
}

/**
 * Get the path to the SQLite database file.
 *
 * Priority:
 * 1. DATABASE_PATH env var (for testing)
 * 2. VS Code storage path (set via setStoragePath)
 * 3. Fallback to temp directory
 */
export function getDatabasePath(): string {
    const envPath = process.env.DATABASE_PATH;
    if (envPath) {
        return envPath;
    }

    if (_storagePath) {
        // Ensure storage directory exists
        if (!existsSync(_storagePath)) {
            mkdirSync(_storagePath, { recursive: true });
        }
        return join(_storagePath, 'movesia.db');
    }

    // Fallback: use temp directory
    const tempDir = process.env.TEMP || process.env.TMP || '/tmp';
    const dataDir = join(tempDir, 'movesia-data');

    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
    }

    logger.warn('No storage path set, using temp directory: ' + dataDir);
    return join(dataDir, 'movesia.db');
}

/**
 * Save the database to disk.
 */
function persistDatabase(): void {
    if (_db && _dbPath) {
        const data = _db.export();
        const buffer = Buffer.from(data);
        writeFileSync(_dbPath, buffer);
    }
}

/**
 * Initialize the database and create tables.
 *
 * Call this during server startup.
 */
export async function initDatabase(): Promise<SqlJsDatabase> {
    _dbPath = getDatabasePath();
    logger.info(`Initializing database at: ${_dbPath}`);

    // Ensure directory exists
    const dbDir = dirname(_dbPath);
    if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
    }

    // Initialize sql.js
    _sqlJs = await initSqlJs();

    // Create or load database
    if (existsSync(_dbPath)) {
        const buffer = readFileSync(_dbPath);
        _db = new _sqlJs.Database(buffer);
        logger.info('Loaded existing database');
    } else {
        _db = new _sqlJs.Database();
        logger.info('Created new database');
    }

    // Create our tables
    _db.run(CONVERSATIONS_SCHEMA);
    logger.info('Database tables created/verified');

    // Persist initial state
    persistDatabase();

    // Initialize LangGraph checkpoint saver using sql.js
    _checkpointSaver = await SqlJsCheckpointer.create(_dbPath);
    logger.info('SqlJsCheckpointer initialized (persistent)');

    return _db;
}

/**
 * Close database connections gracefully.
 */
export async function closeDatabase(): Promise<void> {
    if (_checkpointSaver) {
        _checkpointSaver.close();
        logger.info('Checkpointer closed');
    }

    if (_db) {
        persistDatabase();
        _db.close();
        logger.info('Database connection closed');
    }

    _db = null;
    _checkpointSaver = null;
    _sqlJs = null;
}

/**
 * Get the database instance (must call initDatabase first).
 */
export function getDatabase(): SqlJsDatabase {
    if (_db === null) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return _db;
}

/**
 * Get the LangGraph checkpoint saver.
 */
export function getCheckpointSaver(): SqlJsCheckpointer {
    if (_checkpointSaver === null) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return _checkpointSaver;
}

/**
 * Check if database is initialized.
 */
export function isDatabaseInitialized(): boolean {
    return _db !== null;
}

/**
 * Save database changes to disk.
 * Call this after write operations.
 */
export function saveDatabase(): void {
    persistDatabase();
}
