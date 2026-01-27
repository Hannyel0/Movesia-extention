"""
Configuration and logging setup for Movesia Agent Server.

Provides centralized configuration with environment variable support
and sensible defaults for all WebSocket-related settings.
"""

import os
import sys
import logging
from dataclasses import dataclass, field
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


# =============================================================================
# Logging Configuration
# =============================================================================

# ANSI color codes for terminal output
class LogColors:
    """ANSI escape codes for colored terminal output."""
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"

    # Foreground colors
    BLACK = "\033[30m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"

    # Bright foreground colors
    BRIGHT_BLACK = "\033[90m"
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"
    BRIGHT_WHITE = "\033[97m"

    # Background colors
    BG_GREEN = "\033[42m"
    BG_YELLOW = "\033[43m"
    BG_RED = "\033[41m"
    BG_BLUE = "\033[44m"


class ColoredFormatter(logging.Formatter):
    """Custom formatter with colors and component-based formatting."""

    # Component colors and icons
    COMPONENT_STYLES = {
        "movesia": (LogColors.BRIGHT_CYAN, "🚀"),
        "movesia.unity": (LogColors.MAGENTA, "🎮"),
        "movesia.chat": (LogColors.BLUE, "💬"),
        "movesia.sessions": (LogColors.GREEN, "🔗"),
        "movesia.heartbeat": (LogColors.YELLOW, "💓"),
        "movesia.router": (LogColors.CYAN, "📡"),
        "movesia.transport": (LogColors.BRIGHT_BLACK, "📦"),
        "movesia.agent": (LogColors.BRIGHT_MAGENTA, "🤖"),
        "movesia.streaming": (LogColors.BRIGHT_BLUE, "⚡"),
    }

    # Level colors and labels
    LEVEL_STYLES = {
        logging.DEBUG: (LogColors.BRIGHT_BLACK, "DBG"),
        logging.INFO: (LogColors.GREEN, "INF"),
        logging.WARNING: (LogColors.YELLOW, "WRN"),
        logging.ERROR: (LogColors.RED, "ERR"),
        logging.CRITICAL: (LogColors.BRIGHT_RED + LogColors.BOLD, "CRT"),
    }

    def __init__(self, use_colors: bool = True):
        super().__init__()
        self.use_colors = use_colors and sys.stdout.isatty()

    def format(self, record: logging.LogRecord) -> str:
        # Get component style
        component_color, icon = self.COMPONENT_STYLES.get(
            record.name,
            (LogColors.WHITE, "•")
        )

        # Check for parent logger match
        if record.name not in self.COMPONENT_STYLES:
            for comp_name, style in self.COMPONENT_STYLES.items():
                if record.name.startswith(comp_name + "."):
                    component_color, icon = style
                    break

        # Get level style
        level_color, level_label = self.LEVEL_STYLES.get(
            record.levelno,
            (LogColors.WHITE, "???")
        )

        # Format timestamp (shorter)
        from datetime import datetime
        timestamp = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")

        # Extract short component name
        short_name = record.name.replace("movesia.", "").upper()
        if short_name == "MOVESIA":
            short_name = "SERVER"

        # Build the log line
        if self.use_colors:
            # Colored output
            line = (
                f"{LogColors.DIM}{timestamp}{LogColors.RESET} "
                f"{level_color}{level_label}{LogColors.RESET} "
                f"{icon} {component_color}{short_name:10}{LogColors.RESET} "
                f"{LogColors.BRIGHT_WHITE}{record.getMessage()}{LogColors.RESET}"
            )
        else:
            # Plain output (for file logging or non-TTY)
            line = f"{timestamp} {level_label} {short_name:10} {record.getMessage()}"

        # Add exception info if present
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)

        return line


class UvicornAccessFilter(logging.Filter):
    """Filter to format Uvicorn access logs nicely."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Let all records through, but mark WebSocket ones
        msg = record.getMessage()
        if "WebSocket" in msg:
            # Extract path and status
            if "[accepted]" in msg:
                record.msg = f"🔌 WebSocket connected: {self._extract_path(msg)}"
            elif "403" in msg:
                record.msg = f"⛔ WebSocket rejected: {self._extract_path(msg)}"
        return True

    def _extract_path(self, msg: str) -> str:
        """Extract the path from Uvicorn access log."""
        try:
            # Format: '127.0.0.1:port - "WebSocket /path" [status]'
            if '"WebSocket ' in msg:
                start = msg.index('"WebSocket ') + 11
                end = msg.index('"', start)
                return msg[start:end]
        except (ValueError, IndexError):
            pass
        return msg


def setup_logging(
    level: int = logging.INFO,
    use_colors: bool = True
) -> logging.Logger:
    """
    Configure and return the main logger with improved formatting.

    Args:
        level: Logging level
        use_colors: Whether to use colored output

    Returns:
        Configured logger instance
    """
    # Remove any existing handlers
    root = logging.getLogger()
    for handler in root.handlers[:]:
        root.removeHandler(handler)

    # Create console handler with colored formatter
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(ColoredFormatter(use_colors=use_colors))
    console_handler.setLevel(level)

    # Configure root logger
    root.setLevel(level)
    root.addHandler(console_handler)

    # Create movesia logger hierarchy
    movesia_logger = logging.getLogger("movesia")
    movesia_logger.setLevel(level)
    movesia_logger.propagate = True

    # Child loggers inherit from root
    for child in ["server", "unity", "chat", "sessions", "heartbeat", "router", "transport", "agent", "streaming"]:
        child_logger = logging.getLogger(f"movesia.{child}")
        child_logger.setLevel(level)

    # Silence noisy third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)

    # Configure Uvicorn loggers to be less verbose
    uvicorn_access = logging.getLogger("uvicorn.access")
    uvicorn_access.handlers = []
    uvicorn_access.addHandler(console_handler)
    uvicorn_access.addFilter(UvicornAccessFilter())

    uvicorn_error = logging.getLogger("uvicorn.error")
    uvicorn_error.handlers = []
    uvicorn_error.addHandler(console_handler)

    # Silence uvicorn's default INFO spam
    logging.getLogger("uvicorn").setLevel(logging.WARNING)

    return movesia_logger


def print_startup_banner(host: str, port: int) -> None:
    """Print a nice startup banner."""
    C = LogColors
    banner = f"""
{C.BRIGHT_CYAN}███╗   ███╗ ██████╗ ██╗   ██╗███████╗███████╗██╗ █████╗     ███████╗███████╗██╗   ██╗███████╗██████╗
████╗ ████║██╔═══██╗██║   ██║██╔════╝██╔════╝██║██╔══██╗    ██╔════╝██╔════╝██║   ██║██╔════╝██╔══██╗
██╔████╔██║██║   ██║██║   ██║█████╗  ███████╗██║███████║    ███████╗█████╗  ██║   ██║█████╗  ██████╔╝
██║╚██╔╝██║██║   ██║╚██╗ ██╔╝██╔══╝  ╚════██║██║██╔══██║    ╚════██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██╔══██╗
██║ ╚═╝ ██║╚██████╔╝ ╚████╔╝ ███████╗███████║██║██║  ██║    ███████║███████╗ ╚████╔╝ ███████╗██║  ██║
╚═╝     ╚═╝ ╚═════╝   ╚═══╝  ╚══════╝╚══════╝╚═╝╚═╝  ╚═╝    ╚══════╝╚══════╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
{C.RESET}
  {C.GREEN}▸ Server:{C.WHITE}  http://{host}:{port}
  {C.MAGENTA}▸ Unity:{C.WHITE}   ws://{host}:{port}/ws/unity
  {C.BLUE}▸ Chat:{C.WHITE}    ws://{host}:{port}/ws/chat/{{session}}
  {C.YELLOW}▸ Status:{C.WHITE}  http://{host}:{port}/unity/status
{C.RESET}"""
    print(banner)


# Initialize default logger
logger = setup_logging()


# =============================================================================
# Server Configuration
# =============================================================================

@dataclass
class ServerConfig:
    """Main server configuration."""
    host: str = "127.0.0.1"
    port: int = 8765
    
    # CORS settings
    cors_origins: list = field(default_factory=lambda: ["*"])
    cors_allow_credentials: bool = True
    
    # Logging
    log_level: str = "INFO"
    
    @classmethod
    def from_env(cls) -> "ServerConfig":
        """Create config from environment variables."""
        return cls(
            host=os.getenv("SERVER_HOST", "127.0.0.1"),
            port=int(os.getenv("SERVER_PORT", "8765")),
            log_level=os.getenv("LOG_LEVEL", "INFO")
        )


@dataclass
class UnityConfig:
    """Unity connection configuration."""
    # Timeout settings (in seconds)
    handshake_timeout: float = 10.0
    command_timeout: float = 30.0
    interrupt_timeout: float = 120.0
    reconnect_grace_period: float = 5.0
    
    # Limits
    max_pending_commands: int = 100
    max_message_size: int = 10 * 1024 * 1024  # 10MB
    
    @classmethod
    def from_env(cls) -> "UnityConfig":
        """Create config from environment variables."""
        return cls(
            handshake_timeout=float(os.getenv("UNITY_HANDSHAKE_TIMEOUT", "10.0")),
            command_timeout=float(os.getenv("UNITY_COMMAND_TIMEOUT", "30.0")),
            interrupt_timeout=float(os.getenv("INTERRUPT_TIMEOUT", "120.0"))
        )


@dataclass
class HeartbeatConfig:
    """Heartbeat/keepalive configuration."""
    # Timing (in milliseconds for consistency with TypeScript)
    sweep_interval_ms: int = 40_000  # How often to check connections
    ping_after_idle_ms: int = 90_000  # Send ping after this idle time
    max_idle_ms: int = 600_000  # 10 minutes - disconnect after this
    pong_timeout_ms: int = 20_000  # Wait this long for pong
    max_missed_pongs: int = 3  # Disconnect after this many missed pongs
    closing_force_kill_ms: int = 10_000  # Force kill stuck connections
    
    # Unity compilation handling
    compile_suspend_ms: int = 120_000  # 2 minutes during compilation
    post_compile_grace_ms: int = 30_000  # 30 seconds after compilation
    
    @classmethod
    def from_env(cls) -> "HeartbeatConfig":
        """Create config from environment variables."""
        return cls(
            sweep_interval_ms=int(os.getenv("HEARTBEAT_SWEEP_MS", "40000")),
            ping_after_idle_ms=int(os.getenv("HEARTBEAT_PING_AFTER_MS", "90000")),
            max_idle_ms=int(os.getenv("HEARTBEAT_MAX_IDLE_MS", "600000")),
            compile_suspend_ms=int(os.getenv("COMPILE_SUSPEND_MS", "120000"))
        )


@dataclass
class WebSocketConfig:
    """WebSocket protocol configuration."""
    # Message settings
    max_message_size: int = 10 * 1024 * 1024  # 10MB
    close_timeout: float = 10.0
    
    # Protocol version
    protocol_version: int = 1
    
    # Compression
    enable_compression: bool = True
    compression_level: int = 6
    
    @classmethod
    def from_env(cls) -> "WebSocketConfig":
        """Create config from environment variables."""
        return cls(
            max_message_size=int(os.getenv("WS_MAX_MESSAGE_SIZE", str(10 * 1024 * 1024))),
            enable_compression=os.getenv("WS_COMPRESSION", "true").lower() == "true"
        )


# =============================================================================
# Composite Configuration
# =============================================================================

@dataclass
class Config:
    """Complete application configuration."""
    server: ServerConfig = field(default_factory=ServerConfig)
    unity: UnityConfig = field(default_factory=UnityConfig)
    heartbeat: HeartbeatConfig = field(default_factory=HeartbeatConfig)
    websocket: WebSocketConfig = field(default_factory=WebSocketConfig)
    
    @classmethod
    def from_env(cls) -> "Config":
        """Create complete config from environment."""
        return cls(
            server=ServerConfig.from_env(),
            unity=UnityConfig.from_env(),
            heartbeat=HeartbeatConfig.from_env(),
            websocket=WebSocketConfig.from_env()
        )


# =============================================================================
# Global Configuration Instance
# =============================================================================

# Create global config instance
config = Config.from_env()

# Convenience exports (for backwards compatibility)
SERVER_HOST = config.server.host
SERVER_PORT = config.server.port
UNITY_HANDSHAKE_TIMEOUT = config.unity.handshake_timeout
UNITY_COMMAND_TIMEOUT = config.unity.command_timeout
INTERRUPT_TIMEOUT = config.unity.interrupt_timeout


# =============================================================================
# Constants
# =============================================================================

# WebSocket close codes
class CloseCode:
    """Standard and custom WebSocket close codes."""
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


# Message types
class MessageType:
    """Standard message types."""
    # Control messages
    HELLO = "hello"
    WELCOME = "welcome"
    ACK = "ack"
    ERROR = "error"
    HEARTBEAT = "hb"
    PONG = "pong"
    
    # Lifecycle events
    CONNECTION_ESTABLISHED = "connection_established"
    COMPILE_STARTED = "compile_started"
    COMPILE_FINISHED = "compile_finished"
    
    # Unity events
    HIERARCHY_CHANGED = "hierarchy_changed"
    SELECTION_CHANGED = "selection_changed"
    SCENE_SAVED = "scene_saved"
    PROJECT_CHANGED = "project_changed"
    ASSETS_IMPORTED = "assets_imported"
    ASSETS_DELETED = "assets_deleted"
    ASSETS_MOVED = "assets_moved"
    
    # Commands
    QUERY_HIERARCHY = "query_hierarchy"
    GET_COMPONENT = "get_component"
    SET_PROPERTY = "set_property"
    CREATE_OBJECT = "create_object"
    DELETE_OBJECT = "delete_object"
