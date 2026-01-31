"""
Improved Unity Manager for WebSocket connection management.

Integrates all the best practices:
- Session management with monotonic takeover
- Heartbeat/keepalive with compilation-aware suspension
- Message routing with ACK support
- Command/response correlation
- Graceful reconnection handling
"""

import asyncio
import logging
import uuid
from typing import Optional, Callable, Awaitable, Any, Dict
from contextlib import asynccontextmanager

from fastapi import WebSocket, WebSocketDisconnect

from .types import (
    ExtendedConnection,
    MovesiaMessage,
    ConnectionState,
    ConnectionSource,
    UnityManagerConfig,
    HeartbeatConfig,
    CloseCode
)
from .sessions import UnitySessionManager
from .heartbeat import HeartbeatManager
from .router import MessageRouter, CommandRouter, RouterCallbacks
from .transport import send_to_client, send_welcome, send_error, send_command


logger = logging.getLogger("movesia.unity")


class UnityManager:
    """
    Manages WebSocket connections from Unity Editor.
    
    Features:
    - Single active connection per project/session
    - Automatic takeover of older connections
    - Heartbeat with compilation-aware suspension
    - Command/response correlation for tool calls
    - Interrupt support for async operations
    
    Usage:
        manager = UnityManager(interrupt_manager)
        
        # In WebSocket endpoint
        await manager.handle_connection(websocket)
        
        # From tools
        result = await manager.send_and_wait("query_hierarchy", path="/")
    """
    
    def __init__(
        self,
        interrupt_manager: Any = None,
        config: Optional[UnityManagerConfig] = None,
        on_domain_event: Optional[Callable[[MovesiaMessage], Awaitable[None]]] = None
    ):
        """
        Initialize Unity manager.
        
        Args:
            interrupt_manager: Manager for async interrupts (for domain reload)
            config: Configuration options
            on_domain_event: Callback for domain events from Unity
        """
        self.config = config or UnityManagerConfig()
        self._interrupt_manager = interrupt_manager
        self._on_domain_event = on_domain_event
        
        # Session management
        self._sessions = UnitySessionManager()
        
        # Heartbeat management
        self._heartbeat = HeartbeatManager(
            config=self.config.heartbeat,
            get_connections=self._get_all_connections,
            send_ping=self._send_ping,
            close_connection=self._close_connection
        )
        
        # Message routing
        router_callbacks = RouterCallbacks(
            suspend_heartbeat=self._heartbeat.suspend,
            on_domain_event=self._handle_domain_event,
            send_to_client=self._send_to_websocket,
            on_compilation_started=self._on_compilation_started,
            on_compilation_finished=self._on_compilation_finished
        )
        self._router = MessageRouter(callbacks=router_callbacks)
        
        # Command routing for request/response
        self._command_router = CommandRouter()
        
        # Current connection tracking (for single Unity connection)
        self._current_ws: Optional[WebSocket] = None
        self._current_connection: Optional[ExtendedConnection] = None
        self._current_session: Optional[str] = None
        
        # Connection change callbacks
        self._connection_callbacks: list[Callable[[bool], Awaitable[None]]] = []

        # Pending commands awaiting responses (keyed by message ID)
        self._pending_commands: Dict[str, asyncio.Future] = {}

    # =========================================================================
    # Public API
    # =========================================================================
    
    async def handle_connection(
        self,
        websocket: WebSocket,
        session_id: Optional[str] = None,
        conn_seq: int = 0
    ) -> None:
        """
        Handle a new Unity WebSocket connection.
        
        This is the main entry point called from the WebSocket endpoint.
        
        Args:
            websocket: FastAPI WebSocket
            session_id: Session identifier (from query param or handshake)
            conn_seq: Connection sequence number for takeover logic
        """
        # Accept the WebSocket connection
        await websocket.accept()

        # Generate connection ID
        cid = self._generate_cid()

        # Session and conn_seq come from URL query params (no handshake needed)
        # Project path and unity version can be sent later via "hello" message if needed
        if not session_id:
            session_id = str(uuid.uuid4())
        
        # Create connection metadata
        connection = ExtendedConnection(
            cid=cid,
            session=session_id,
            conn_seq=conn_seq,
        )

        # Try to accept the session
        decision = await self._sessions.accept(
            session_id=session_id,
            conn_seq=conn_seq,
            connection=connection,
            websocket=websocket,
        )
        
        if not decision.accept:
            logger.info(f"Rejecting connection [{cid}]: {decision.reason}")
            await websocket.close(
                code=CloseCode.DUPLICATE_SESSION,
                reason=decision.reason or "duplicate session"
            )
            return
        
        # Supersede old connection if needed
        if decision.supersede:
            try:
                old_ws = decision.supersede
                await old_ws.close(
                    code=CloseCode.SUPERSEDED,
                    reason="superseded by newer connection"
                )
            except Exception as e:
                logger.debug(f"Error closing superseded connection: {e}")
        
        # Update current connection
        self._current_ws = websocket
        self._current_connection = connection
        self._current_session = session_id
        connection.state = ConnectionState.OPEN
        
        # Start heartbeat if not running
        self._heartbeat.start()
        
        # Notify connection change
        await self._notify_connection_change(True)
        
        # Send welcome message
        await send_welcome(websocket, {
            "cid": cid,
            "session": session_id,
            "server_version": "2.0.0"
        })
        
        short_session = session_id[:8] if session_id else "none"
        logger.info(f"Unity connected [{cid}] session={short_session}")
        
        # Main message loop
        try:
            await self._message_loop(websocket, connection)
        except WebSocketDisconnect as e:
            logger.info(f"Unity disconnected [{cid}]")
        except Exception as e:
            logger.error(f"Unity connection error [{cid}]: {e}", exc_info=True)
        finally:
            await self._cleanup_connection(websocket, connection, session_id)
    
    async def send_and_wait(
        self,
        command_type: str,
        timeout: Optional[float] = None,
        **kwargs
    ) -> dict:
        """
        Send a command to Unity and wait for response.
        
        Args:
            command_type: Type of command (e.g., "query_hierarchy")
            timeout: Timeout in seconds (defaults to config)
            **kwargs: Command parameters
            
        Returns:
            Response body from Unity
            
        Raises:
            RuntimeError: If no Unity connection
            asyncio.TimeoutError: If response times out
        """
        if not self._current_ws or not self._current_connection:
            raise RuntimeError("No Unity connection available")
        
        timeout = timeout or self.config.command_timeout

        # Create and send command
        msg = MovesiaMessage.create(
            msg_type=command_type,
            body=kwargs,  # No need for request_id - we use msg.id for correlation
            source=ConnectionSource.VSCODE,
            session=self._current_session
        )

        # Register for response using message ID (Unity echoes this back)
        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending_commands[msg.id] = future
        logger.info(f"📤 Registered pending command: msg.id={msg.id}, pending_commands={list(self._pending_commands.keys())}")

        try:
            await send_to_client(self._current_ws, msg.to_dict())

            logger.info(f"Sent command {command_type} [msg.id={msg.id}]")

            return await asyncio.wait_for(future, timeout)

        except asyncio.TimeoutError:
            logger.warning(f"Command {command_type} timed out after {timeout}s")
            raise
        finally:
            self._pending_commands.pop(msg.id, None)
    
    @property
    def is_connected(self) -> bool:
        """Check if Unity is currently connected."""
        return (
            self._current_ws is not None and 
            self._current_connection is not None and
            self._current_connection.state == ConnectionState.OPEN
        )
    
    @property
    def current_project(self) -> Optional[str]:
        """Get current Unity project path."""
        if self._current_connection:
            return self._current_connection.project_path
        return None
    
    @property
    def is_compiling(self) -> bool:
        """Check if Unity is currently compiling."""
        if self._current_connection:
            return self._current_connection.is_compiling
        return False
    
    @property
    def connection_count(self) -> int:
        """Get number of active connections."""
        return self._sessions.size
    
    def on_connection_change(
        self, 
        callback: Callable[[bool], Awaitable[None]]
    ) -> None:
        """Register callback for connection state changes."""
        self._connection_callbacks.append(callback)
    
    async def close_all(self) -> None:
        """Close all Unity connections."""
        self._heartbeat.stop()
        await self._command_router.cancel_all()
        
        sessions = await self._sessions.get_all_sessions()
        for session_id, entry in sessions.items():
            try:
                await entry.websocket.close(
                    code=CloseCode.GOING_AWAY,
                    reason="server shutdown"
                )
            except Exception:
                pass
        
        await self._sessions.clear_all()
        self._current_ws = None
        self._current_connection = None
        self._current_session = None
    
    # =========================================================================
    # Private Implementation
    # =========================================================================

    async def _message_loop(
        self,
        websocket: WebSocket,
        connection: ExtendedConnection
    ) -> None:
        """Main loop for receiving and processing messages."""
        while True:
            # Receive message
            data = await websocket.receive_text()


            # Route through message router
            msg = await self._router.handle_message(websocket, connection, data)

            if msg is None:
                continue

            # Check if this is a response to a pending command (matched by message ID)
            # Unity echoes back the original message ID in its response
            if msg.id in self._pending_commands:
                future = self._pending_commands.get(msg.id)
                if future and not future.done():
                    future.set_result(msg.body)
    
    async def _cleanup_connection(
        self,
        websocket: WebSocket,
        connection: ExtendedConnection,
        session_id: str
    ) -> None:
        """Clean up after connection closes."""
        connection.state = ConnectionState.CLOSED
        
        # Clear from sessions
        await self._sessions.clear_if_match(session_id, websocket)
        
        # Clear current connection if it matches
        if self._current_ws is websocket:
            self._current_ws = None
            self._current_connection = None
            self._current_session = None
        
        # Cancel pending commands
        for request_id, future in list(self._pending_commands.items()):
            if not future.done():
                future.set_exception(RuntimeError("Connection closed"))
        self._pending_commands.clear()
        
        # Notify connection change
        await self._notify_connection_change(False)
        
        # Stop heartbeat if no more connections
        if self._sessions.size == 0:
            self._heartbeat.stop()
        
        logger.info(f"Cleaned up connection [{connection.cid}]")
    
    async def _handle_domain_event(self, msg: MovesiaMessage) -> None:
        """Forward domain events to subscribers."""
        if self._on_domain_event:
            try:
                await self._on_domain_event(msg)
            except Exception as e:
                logger.error(f"Error in domain event handler: {e}")
    
    async def _on_compilation_started(self, cid: str) -> None:
        """Handle Unity compilation start."""
        logger.info(f"Unity compilation started [{cid}]")
        
        # Cancel pending commands (they'll fail anyway)
        for request_id, future in list(self._pending_commands.items()):
            if not future.done():
                future.set_exception(RuntimeError("Compilation started"))
        self._pending_commands.clear()
    
    async def _on_compilation_finished(self, cid: str) -> None:
        """Handle Unity compilation finish."""
        logger.info(f"Unity compilation finished [{cid}]")
        
        # Resume any interrupted operations
        if self._interrupt_manager:
            try:
                await self._interrupt_manager.resume_all()
            except Exception as e:
                logger.error(f"Error resuming interrupts: {e}")
    
    async def _notify_connection_change(self, connected: bool) -> None:
        """Notify all connection change callbacks."""
        for callback in self._connection_callbacks:
            try:
                await callback(connected)
            except Exception as e:
                logger.error(f"Error in connection change callback: {e}")
    
    async def _get_all_connections(self) -> Dict[str, Any]:
        """Get all connections for heartbeat manager."""
        return await self._sessions.get_all_sessions()
    
    async def _send_ping(self, ws: WebSocket, cid: str) -> None:
        """Send ping to a connection."""
        msg = MovesiaMessage.create(
            msg_type="hb",
            body={},
            source=ConnectionSource.VSCODE
        )
        try:
            await send_to_client(ws, msg.to_dict())
        except Exception as e:
            logger.debug(f"Failed to send ping to [{cid}]: {e}")
    
    async def _close_connection(
        self, 
        ws: WebSocket, 
        code: int, 
        reason: str
    ) -> None:
        """Close a WebSocket connection."""
        try:
            await ws.close(code=code, reason=reason)
        except Exception as e:
            logger.debug(f"Error closing connection: {e}")
    
    async def _send_to_websocket(self, ws: WebSocket, message: dict) -> None:
        """Send message to a WebSocket."""
        await send_to_client(ws, message)
    
    @staticmethod
    def _generate_cid() -> str:
        """Generate a short connection ID."""
        import random
        import string
        return ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))


# Convenience function for backwards compatibility with existing code
def create_unity_manager(
    interrupt_manager: Any = None,
    on_domain_event: Optional[Callable[[MovesiaMessage], Awaitable[None]]] = None
) -> UnityManager:
    """Create a Unity manager with default configuration."""
    return UnityManager(
        interrupt_manager=interrupt_manager,
        on_domain_event=on_domain_event
    )
