"""
Message Router for WebSocket communication.

Handles:
- Message parsing and validation
- Message type routing
- ACK generation for important messages
- Compilation event handling
- Domain event forwarding

The router acts as a central hub for all incoming messages, ensuring
consistent handling and proper acknowledgment of important operations.
"""

import asyncio
import logging
import json
import time
from typing import Optional, Callable, Awaitable, Any, Set
from dataclasses import dataclass

from .types import (
    MovesiaMessage, 
    ACK_REQUIRED_TYPES, 
    ExtendedConnection,
    ConnectionSource
)


logger = logging.getLogger("movesia.router")


@dataclass
class RouterCallbacks:
    """Callbacks for the message router."""
    suspend_heartbeat: Optional[Callable[[int], None]] = None
    on_domain_event: Optional[Callable[[MovesiaMessage], Awaitable[None]]] = None
    send_to_client: Optional[Callable[[Any, dict], Awaitable[None]]] = None
    on_compilation_started: Optional[Callable[[str], Awaitable[None]]] = None
    on_compilation_finished: Optional[Callable[[str], Awaitable[None]]] = None


class MessageRouter:
    """
    Routes and processes incoming WebSocket messages.
    
    Responsibilities:
    - Parse and validate message format
    - Route messages to appropriate handlers
    - Send acknowledgments for important messages
    - Handle compilation events specially
    - Forward domain events to subscribers
    """
    
    # Message types that are handled internally (not forwarded)
    INTERNAL_TYPES: Set[str] = {"hb", "ack", "pong"}
    
    # Compilation suspend durations
    COMPILE_START_SUSPEND_MS = 120_000  # 2 minutes
    COMPILE_FINISH_SUSPEND_MS = 30_000  # 30 seconds (grace period)
    
    def __init__(self, callbacks: Optional[RouterCallbacks] = None):
        """
        Initialize the message router.
        
        Args:
            callbacks: RouterCallbacks with handler functions
        """
        self.callbacks = callbacks or RouterCallbacks()
    
    async def handle_message(
        self, 
        ws: Any, 
        connection: ExtendedConnection,
        raw_data: str | bytes
    ) -> Optional[MovesiaMessage]:
        """
        Handle an incoming WebSocket message.
        
        Args:
            ws: WebSocket connection
            connection: Extended connection metadata
            raw_data: Raw message data (string or bytes)
            
        Returns:
            Parsed MovesiaMessage if valid and not internal, None otherwise
        """
        # Update connection activity
        connection.update_seen()
        
        # Parse the message
        try:
            text = raw_data if isinstance(raw_data, str) else raw_data.decode('utf-8')
            data = json.loads(text)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            logger.warning(f"Invalid JSON from [{connection.cid}]: {e}")
            return None

        # Validate message envelope
        msg = self._validate_message(data, connection.cid)
        if msg is None:
            return None

        # Update session from message if present
        if msg.session:
            connection.session = msg.session
        
        # Handle special message types
        handled = await self._handle_special_types(ws, connection, msg)
        if handled:
            return None  # Don't forward internal messages
        
        # Send ACK if required
        if self._should_ack(msg.type):
            await self._send_ack(ws, msg.id, connection.cid)
        
        # Forward to domain event handler
        if self.callbacks.on_domain_event:
            try:
                await self.callbacks.on_domain_event(msg)
            except Exception as e:
                logger.error(f"Error in domain event handler: {e}", exc_info=True)
        
        return msg
    
    def _validate_message(
        self, 
        data: dict, 
        cid: str
    ) -> Optional[MovesiaMessage]:
        """
        Validate message envelope format.
        
        Args:
            data: Parsed JSON data
            cid: Connection ID for logging
            
        Returns:
            MovesiaMessage if valid, None otherwise
        """
        # Check required fields
        required_fields = ['source', 'type', 'ts', 'id']
        missing = [f for f in required_fields if f not in data]

        if missing:
            logger.warning(f"Invalid message from [{cid}]: missing {missing}")
            return None

        # Ensure body exists (default to empty dict)
        if 'body' not in data:
            data['body'] = {}

        # Validate types
        if not isinstance(data.get('type'), str):
            logger.warning(f"Invalid message from [{cid}]: 'type' must be string")
            return None
        
        try:
            return MovesiaMessage.from_dict(data)
        except Exception as e:
            logger.warning(f"Failed to parse message from [{cid}]: {e}")
            return None
    
    async def _handle_special_types(
        self, 
        ws: Any, 
        connection: ExtendedConnection,
        msg: MovesiaMessage
    ) -> bool:
        """
        Handle special/internal message types.
        
        Args:
            ws: WebSocket connection
            connection: Connection metadata
            msg: Parsed message
            
        Returns:
            True if message was handled internally, False to continue processing
        """
        msg_type = msg.type
        
        # Heartbeat/keepalive
        if msg_type == "hb":
            # Respond with pong
            await self._send_pong(ws, msg.id)
            return True
        
        # ACK (acknowledgment of our message)
        if msg_type == "ack":
            # Could track ACKs for delivery confirmation
            return True
        
        # Pong (response to our heartbeat)
        if msg_type == "pong":
            # Heartbeat manager handles this
            return True
        
        # Compilation started
        if msg_type == "compile_started":
            logger.info(f"Unity compilation started [{connection.cid}]")
            connection.is_compiling = True
            
            if self.callbacks.suspend_heartbeat:
                self.callbacks.suspend_heartbeat(self.COMPILE_START_SUSPEND_MS)
            
            if self.callbacks.on_compilation_started:
                await self.callbacks.on_compilation_started(connection.cid)
            
            return False  # Still forward as domain event
        
        # Compilation finished
        if msg_type == "compile_finished":
            logger.info(f"Unity compilation finished [{connection.cid}]")
            connection.is_compiling = False
            
            if self.callbacks.suspend_heartbeat:
                self.callbacks.suspend_heartbeat(self.COMPILE_FINISH_SUSPEND_MS)
            
            if self.callbacks.on_compilation_finished:
                await self.callbacks.on_compilation_finished(connection.cid)
            
            return False  # Still forward as domain event
        
        return False
    
    def _should_ack(self, msg_type: str) -> bool:
        """Check if message type requires acknowledgment."""
        return msg_type in ACK_REQUIRED_TYPES
    
    async def _send_ack(self, ws: Any, msg_id: str, cid: str) -> None:
        """Send acknowledgment message."""
        ack = MovesiaMessage.create(
            msg_type="ack",
            body={},
            source=ConnectionSource.VSCODE
        )
        # Use the original message ID for correlation
        ack.id = msg_id
        
        if self.callbacks.send_to_client:
            await self.callbacks.send_to_client(ws, ack.to_dict())
    
    async def _send_pong(self, ws: Any, msg_id: str) -> None:
        """Send pong response to heartbeat."""
        pong = MovesiaMessage.create(
            msg_type="pong",
            body={},
            source=ConnectionSource.VSCODE
        )
        pong.id = msg_id  # Echo back the heartbeat ID
        
        if self.callbacks.send_to_client:
            await self.callbacks.send_to_client(ws, pong.to_dict())


class CommandRouter:
    """
    Routes outgoing commands to Unity and tracks responses.
    
    Provides request/response correlation for commands that expect
    results from Unity, using request IDs to match responses.
    """
    
    def __init__(self):
        self._pending: dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()
    
    async def send_command(
        self, 
        ws: Any, 
        command_type: str,
        body: dict,
        send_func: Callable[[Any, dict], Awaitable[None]],
        timeout: float = 30.0
    ) -> dict:
        """
        Send a command and wait for response.
        
        Args:
            ws: WebSocket to send through
            command_type: Type of command
            body: Command body/parameters
            send_func: Function to send the message
            timeout: How long to wait for response
            
        Returns:
            Response body
            
        Raises:
            asyncio.TimeoutError: If no response within timeout
        """
        msg = MovesiaMessage.create(
            msg_type=command_type,
            body=body,
            source=ConnectionSource.VSCODE
        )
        
        # Create future for response
        future: asyncio.Future = asyncio.get_event_loop().create_future()
        
        async with self._lock:
            self._pending[msg.id] = future
        
        try:
            # Send the command
            await send_func(ws, msg.to_dict())
            
            # Wait for response
            return await asyncio.wait_for(future, timeout)
            
        except asyncio.TimeoutError:
            logger.warning(f"Command {command_type} timed out after {timeout}s")
            raise
        finally:
            async with self._lock:
                self._pending.pop(msg.id, None)
    
    async def handle_response(self, msg: MovesiaMessage) -> bool:
        """
        Handle a potential response message.
        
        Args:
            msg: Message that might be a response
            
        Returns:
            True if this was a response to a pending command
        """
        # Check if this is a response to a pending command
        # Responses typically have request_id in body
        request_id = msg.body.get("request_id")
        
        if not request_id:
            return False
        
        async with self._lock:
            future = self._pending.get(request_id)
            
            if future and not future.done():
                future.set_result(msg.body)
                return True
        
        return False
    
    async def cancel_all(self) -> None:
        """Cancel all pending commands."""
        async with self._lock:
            for request_id, future in self._pending.items():
                if not future.done():
                    future.cancel()
            self._pending.clear()
