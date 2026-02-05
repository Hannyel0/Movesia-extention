/**
 * Database module for Movesia Agent.
 *
 * Provides:
 * - Conversation metadata storage (for listing threads)
 * - LangGraph checkpoints (messages stored automatically)
 */

// Models
export {
    type Conversation,
    createConversation,
    generateUuid,
    rowToConversation,
    conversationToRow,
    CONVERSATIONS_SCHEMA,
} from './models';

// Repository
export {
    ConversationRepository,
    getRepository,
} from './repository';

// Engine
export {
    initDatabase,
    closeDatabase,
    getDatabase,
    getCheckpointSaver,
    getDatabasePath,
    isDatabaseInitialized,
} from './engine';
