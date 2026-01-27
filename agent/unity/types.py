"""
Type definitions for WebSocket connection management.

Mirrors the well-structured TypeScript types for consistency across the stack.
"""

from dataclasses import dataclass, field
from typing import Optional, Callable, Any, Protocol, Awaitable
from enum import Enum
from datetime import datetime
import time


class ConnectionSource(str, Enum):
    """Source of the WebSocket connection."""
    UNITY = "unity"
    VSCODE = "vscode"
    ELECTRON = "electron"


class ConnectionState(str, Enum):
    """State of a WebSocket connection."""
    CONNECTING = "connecting"
    OPEN = "open"
    CLOSING = "closing"
    CLOSED = "closed"


@dataclass
class MovesiaMessage:
    """
    Standardized message envelope for all WebSocket communication.

    Matches the TypeScript MovesiaMessage interface for cross-platform consistency.
    """
    source: ConnectionSource
    type: str
    ts: int  # Unix timestamp in seconds
    id: str  # Unique message ID
    body: dict = field(default_factory=dict)
    session: Optional[str] = None
    
    @classmethod
    def create(
        cls,
        msg_type: str,
        body: dict,
        source: ConnectionSource = ConnectionSource.VSCODE,
        session: Optional[str] = None
    ) -> "MovesiaMessage":
        """Factory method to create a new message with auto-generated ID and timestamp."""
        import uuid
        return cls(
            source=source,
            type=msg_type,
            ts=int(time.time()),
            id=str(uuid.uuid4()),
            body=body,
            session=session
        )
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "source": self.source.value if isinstance(self.source, ConnectionSource) else self.source,
            "type": self.type,
            "ts": self.ts,
            "id": self.id,
            "body": self.body,
            **({"session": self.session} if self.session else {})
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "MovesiaMessage":
        """Create from dictionary (e.g., parsed JSON)."""
        source = data.get("source", "unity")
        if isinstance(source, str):
            try:
                source = ConnectionSource(source)
            except ValueError:
                source = ConnectionSource.UNITY

        return cls(
            source=source,
            type=data.get("type", "unknown"),
            ts=data.get("ts", int(time.time())),
            id=data.get("id", ""),
            body=data.get("body", {}),
            session=data.get("session")
        )


@dataclass
class ExtendedConnection:
    """
    Extended connection metadata tracking.
    
    Stores all relevant state for a WebSocket connection including
    health monitoring, session binding, and lifecycle tracking.
    """
    cid: str  # Connection ID (short random identifier)
    session: Optional[str] = None
    project_path: Optional[str] = None
    conn_seq: int = 0  # Connection sequence for monotonic takeover
    
    # Health tracking
    is_alive: bool = True
    missed_pongs: int = 0
    last_seen: float = field(default_factory=time.time)
    last_ping_sent: Optional[float] = None
    latency_ms: Optional[float] = None
    
    # Lifecycle tracking
    connected_at: float = field(default_factory=time.time)
    closing_since: Optional[float] = None
    state: ConnectionState = ConnectionState.CONNECTING
    
    # Unity-specific
    unity_version: Optional[str] = None
    is_compiling: bool = False
    
    def update_seen(self) -> None:
        """Update last seen timestamp and reset health counters."""
        self.last_seen = time.time()
        self.is_alive = True
        self.missed_pongs = 0
    
    def mark_pong_received(self, ping_time: float) -> None:
        """Record pong receipt and calculate latency."""
        self.is_alive = True
        self.missed_pongs = 0
        self.last_seen = time.time()
        if ping_time:
            self.latency_ms = (time.time() - ping_time) * 1000
    
    def mark_ping_sent(self) -> None:
        """Record that a ping was sent."""
        self.last_ping_sent = time.time()
    
    def age_seconds(self) -> float:
        """Get connection age in seconds."""
        return time.time() - self.connected_at
    
    def idle_seconds(self) -> float:
        """Get idle time since last activity."""
        return time.time() - self.last_seen


@dataclass
class SessionEntry:
    """Entry in the session manager tracking active sessions."""
    session_id: str
    conn_seq: int
    connection: ExtendedConnection
    websocket: Any  # FastAPI WebSocket
    created_at: float = field(default_factory=time.time)


# Callback type definitions
OnConnectionChange = Callable[[bool], Awaitable[None]]
OnDomainEvent = Callable[[MovesiaMessage], Awaitable[None]]


@dataclass
class HeartbeatConfig:
    """Configuration for heartbeat/keepalive behavior."""
    sweep_interval_ms: int = 40_000  # How often to check connections
    ping_after_idle_ms: int = 90_000  # Send ping after this idle time
    max_idle_ms: int = 600_000  # 10 minutes - disconnect after this
    pong_timeout_ms: int = 20_000  # Wait this long for pong
    max_missed_pongs: int = 3  # Disconnect after this many missed pongs
    closing_force_kill_ms: int = 10_000  # Force kill connections stuck in closing
    
    # Compilation-aware settings
    compile_suspend_ms: int = 120_000  # Suspend heartbeat during compilation
    post_compile_grace_ms: int = 30_000  # Grace period after compilation


@dataclass
class UnityManagerConfig:
    """Configuration for the Unity manager."""
    handshake_timeout: float = 10.0
    command_timeout: float = 30.0
    interrupt_timeout: float = 120.0
    reconnect_grace_period: float = 5.0
    max_pending_commands: int = 100
    heartbeat: HeartbeatConfig = field(default_factory=HeartbeatConfig)


# Message types that should receive ACK
ACK_REQUIRED_TYPES = frozenset({
    "hello",
    "assets_imported",
    "assets_deleted",
    "assets_moved",
    "scene_saved",
    "project_changed",
    "compile_started",
    "compile_finished",
    "will_save_assets",
    "hierarchy_changed",
    "selection_changed",
})


# Close codes (matching WebSocket standard + custom)
class CloseCode:
    NORMAL = 1000
    GOING_AWAY = 1001
    PROTOCOL_ERROR = 1002
    UNSUPPORTED = 1003
    NO_STATUS = 1005
    ABNORMAL = 1006
    INVALID_DATA = 1007
    POLICY_VIOLATION = 1008
    MESSAGE_TOO_BIG = 1009
    EXTENSION_REQUIRED = 1010
    INTERNAL_ERROR = 1011
    SERVICE_RESTART = 1012
    TRY_AGAIN_LATER = 1013
    
    # Custom codes (4000-4999)
    SUPERSEDED = 4001  # Connection superseded by newer one
    DUPLICATE_SESSION = 4002
    AUTHENTICATION_FAILED = 4003
    SESSION_EXPIRED = 4004
    COMPILATION_RESET = 4005
