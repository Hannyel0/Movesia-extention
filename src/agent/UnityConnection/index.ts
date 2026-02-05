/**
 * Movesia Improved WebSocket Management
 *
 * A comprehensive WebSocket connection management system for Unity Editor integration.
 *
 * Features:
 * - Session management with monotonic connection takeover
 * - Heartbeat/keepalive with compilation-aware suspension
 * - Standardized message envelopes with ACK support
 * - Command/response correlation for tool calls
 * - Graceful reconnection handling
 *
 * Usage:
 *     import { UnityManager, createConfig } from './UnityConnection';
 *
 *     const config = createConfig();
 *     const manager = new UnityManager({ config: config.unity });
 *
 *     // In WebSocket endpoint
 *     wss.on('connection', (ws) => {
 *         manager.handleConnection(ws);
 *     });
 */

// =============================================================================
// Type Definitions
// =============================================================================

export {
    // Enums
    ConnectionSource,
    ConnectionState,

    // Message types
    MovesiaMessage,
    MovesiaMessageSchema,
    type MovesiaMessageData,

    // Connection types
    type ExtendedConnection,
    createExtendedConnection,
    updateConnectionSeen,
    markPongReceived,
    markPingSent,
    connectionAge,
    connectionIdleTime,

    // Session types
    type SessionEntry,

    // Configuration types
    type HeartbeatConfig,
    DEFAULT_HEARTBEAT_CONFIG,
    type UnityManagerConfig,
    DEFAULT_UNITY_MANAGER_CONFIG,

    // Constants
    ACK_REQUIRED_TYPES,
    CloseCode,
    MessageType,

    // Callback types
    type OnConnectionChange,
    type OnDomainEvent
} from './types';

// =============================================================================
// Configuration
// =============================================================================

export {
    // Logging
    LogColors,
    LogLevel,
    createLogger,
    setLogLevel,
    parseLogLevel,
    printStartupBanner,
    logger,

    // Server config
    type ServerConfig,
    DEFAULT_SERVER_CONFIG,
    createServerConfig,

    // Unity config
    type UnityConfig,
    DEFAULT_UNITY_CONFIG,
    createUnityConfig,

    // Heartbeat config
    createHeartbeatConfig,

    // WebSocket config
    type WebSocketConfig,
    DEFAULT_WEBSOCKET_CONFIG,
    createWebSocketConfig,

    // Composite config
    type Config,
    createConfig,
    config,

    // Convenience exports
    SERVER_HOST,
    SERVER_PORT,
    UNITY_HANDSHAKE_TIMEOUT,
    UNITY_COMMAND_TIMEOUT,
    INTERRUPT_TIMEOUT
} from './config';

// =============================================================================
// Session Management
// =============================================================================

export {
    type AcceptDecision,
    SessionManager,
    UnitySessionManager
} from './sessions';

// =============================================================================
// Heartbeat Management
// =============================================================================

export {
    type GetConnectionsCallback,
    type SendPingCallback,
    type CloseConnectionCallback,
    HeartbeatManager,
    ApplicationHeartbeat
} from './heartbeat';

// =============================================================================
// Message Routing
// =============================================================================

export {
    type RouterCallbacks,
    MessageRouter,
    CommandRouter
} from './router';

// =============================================================================
// Transport Utilities
// =============================================================================

export {
    sendToClient,
    sendMessage,
    sendWelcome,
    sendError,
    sendAck,
    sendPing,
    sendCommand,
    broadcast,
    MessageQueue,
    ReliableTransport
} from './transport';

// =============================================================================
// Unity Manager
// =============================================================================

export {
    type ConnectionChangeCallback,
    type DomainEventCallback,
    type InterruptManager,
    UnityManager,
    createUnityManager
} from './UnityManager';

// =============================================================================
// Package Info
// =============================================================================

export const VERSION = '2.0.0';
