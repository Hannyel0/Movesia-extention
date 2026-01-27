"""
Movesia Improved WebSocket Management

A comprehensive WebSocket connection management system for Unity Editor integration.

Features:
- Session management with monotonic connection takeover
- Heartbeat/keepalive with compilation-aware suspension
- Standardized message envelopes with ACK support
- Command/response correlation for tool calls
- Graceful reconnection handling

Usage:
    from improved_ws import UnityManager, Config
    
    config = Config.from_env()
    manager = UnityManager(config=config.unity)
    
    # In FastAPI endpoint
    @app.websocket("/ws/unity")
    async def unity_endpoint(websocket: WebSocket):
        await manager.handle_connection(websocket)
"""

# Type definitions
from .types import (
    MovesiaMessage,
    ExtendedConnection,
    ConnectionSource,
    ConnectionState,
    CloseCode,
    HeartbeatConfig as HeartbeatConfigType,
    UnityManagerConfig,
    ACK_REQUIRED_TYPES
)

# Configuration
from .config import (
    Config,
    ServerConfig,
    UnityConfig,
    HeartbeatConfig,
    WebSocketConfig,
    config,
    logger,
    setup_logging,
    SERVER_HOST,
    SERVER_PORT,
    UNITY_HANDSHAKE_TIMEOUT,
    UNITY_COMMAND_TIMEOUT,
    INTERRUPT_TIMEOUT
)

# Session management
from .sessions import (
    SessionManager,
    UnitySessionManager,
    SessionEntry,
    AcceptDecision
)

# Heartbeat management
from .heartbeat import (
    HeartbeatManager,
    ApplicationHeartbeat
)

# Message routing
from .router import (
    MessageRouter,
    CommandRouter,
    RouterCallbacks
)

# Transport utilities
from .transport import (
    send_to_client,
    send_message,
    send_welcome,
    send_error,
    send_ack,
    send_ping,
    send_command,
    broadcast,
    MessageQueue,
    ReliableTransport
)

# Unity manager
from .unity_manager import (
    UnityManager,
    create_unity_manager
)

__all__ = [
    # Types
    "MovesiaMessage",
    "ExtendedConnection",
    "ConnectionSource",
    "ConnectionState",
    "CloseCode",
    "HeartbeatConfigType",
    "UnityManagerConfig",
    "ACK_REQUIRED_TYPES",
    
    # Configuration
    "Config",
    "ServerConfig",
    "UnityConfig",
    "HeartbeatConfig",
    "WebSocketConfig",
    "config",
    "logger",
    "setup_logging",
    "SERVER_HOST",
    "SERVER_PORT",
    "UNITY_HANDSHAKE_TIMEOUT",
    "UNITY_COMMAND_TIMEOUT",
    "INTERRUPT_TIMEOUT",
    
    # Session management
    "SessionManager",
    "UnitySessionManager",
    "SessionEntry",
    "AcceptDecision",
    
    # Heartbeat
    "HeartbeatManager",
    "ApplicationHeartbeat",
    
    # Router
    "MessageRouter",
    "CommandRouter",
    "RouterCallbacks",
    
    # Transport
    "send_to_client",
    "send_message",
    "send_welcome",
    "send_error",
    "send_ack",
    "send_ping",
    "send_command",
    "broadcast",
    "MessageQueue",
    "ReliableTransport",
    
    # Manager
    "UnityManager",
    "create_unity_manager",
]

__version__ = "2.0.0"
