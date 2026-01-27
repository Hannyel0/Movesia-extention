"""
Transport utilities for WebSocket message sending.

Provides standardized message formatting and sending functions
to ensure consistent communication across all connections.
"""

import json
import logging
import asyncio
from typing import Any, Optional
from fastapi import WebSocket, WebSocketDisconnect

from .types import MovesiaMessage, ConnectionSource


logger = logging.getLogger("movesia.transport")


async def send_to_client(
    ws: WebSocket, 
    message: dict,
    source: ConnectionSource = ConnectionSource.VSCODE
) -> bool:
    """
    Send a message to a WebSocket client.
    
    Wraps the message in the standard Movesia envelope if not already formatted.
    
    Args:
        ws: WebSocket connection
        message: Message to send (dict or MovesiaMessage)
        source: Source identifier
        
    Returns:
        True if sent successfully, False otherwise
    """
    try:
        # Check if already a properly formatted envelope
        if _is_valid_envelope(message):
            envelope = message
        else:
            # Wrap in envelope
            msg = MovesiaMessage.create(
                msg_type=message.get("type", "message"),
                body=message.get("body", message),
                source=source,
                session=message.get("session")
            )
            envelope = msg.to_dict()
        
        await ws.send_json(envelope)
        return True
        
    except WebSocketDisconnect:
        logger.debug("Cannot send - WebSocket disconnected")
        return False
    except Exception as e:
        logger.error(f"Failed to send message: {e}")
        return False


async def send_message(
    ws: WebSocket,
    msg_type: str,
    body: dict,
    session: Optional[str] = None,
    source: ConnectionSource = ConnectionSource.VSCODE
) -> bool:
    """
    Send a typed message to a WebSocket client.
    
    Convenience function for sending messages with explicit type and body.
    
    Args:
        ws: WebSocket connection
        msg_type: Message type
        body: Message body
        session: Optional session identifier
        source: Source identifier
        
    Returns:
        True if sent successfully
    """
    msg = MovesiaMessage.create(
        msg_type=msg_type,
        body=body,
        source=source,
        session=session
    )
    return await send_to_client(ws, msg.to_dict())


async def send_welcome(
    ws: WebSocket,
    extra_info: Optional[dict] = None
) -> bool:
    """
    Send welcome message to a newly connected client.
    
    Args:
        ws: WebSocket connection
        extra_info: Additional info to include in welcome
        
    Returns:
        True if sent successfully
    """
    body = {
        "message": "Connected to Movesia Agent Server",
        **(extra_info or {})
    }
    return await send_message(ws, "welcome", body)


async def send_error(
    ws: WebSocket,
    error_message: str,
    error_code: Optional[str] = None,
    request_id: Optional[str] = None
) -> bool:
    """
    Send error message to client.
    
    Args:
        ws: WebSocket connection
        error_message: Human-readable error message
        error_code: Machine-readable error code
        request_id: ID of request that caused error
        
    Returns:
        True if sent successfully
    """
    body = {
        "error": error_message,
        **({"error_code": error_code} if error_code else {}),
        **({"request_id": request_id} if request_id else {})
    }
    return await send_message(ws, "error", body)


async def send_ack(
    ws: WebSocket,
    msg_id: str
) -> bool:
    """
    Send acknowledgment for a received message.
    
    Args:
        ws: WebSocket connection
        msg_id: ID of message being acknowledged
        
    Returns:
        True if sent successfully
    """
    msg = MovesiaMessage.create(
        msg_type="ack",
        body={},
        source=ConnectionSource.VSCODE
    )
    msg.id = msg_id  # Use original message ID
    return await send_to_client(ws, msg.to_dict())


async def send_ping(
    ws: WebSocket,
    ping_id: Optional[str] = None
) -> Optional[str]:
    """
    Send application-level ping.
    
    Args:
        ws: WebSocket connection
        ping_id: Optional ping ID (auto-generated if not provided)
        
    Returns:
        Ping ID if sent successfully, None otherwise
    """
    import uuid
    ping_id = ping_id or str(uuid.uuid4())
    
    msg = MovesiaMessage.create(
        msg_type="hb",
        body={},
        source=ConnectionSource.VSCODE
    )
    msg.id = ping_id
    
    if await send_to_client(ws, msg.to_dict()):
        return ping_id
    return None


async def send_command(
    ws: WebSocket,
    command_type: str,
    request_id: str,
    **kwargs
) -> bool:
    """
    Send a command to Unity.
    
    Args:
        ws: WebSocket connection
        command_type: Type of command
        request_id: Request ID for response correlation
        **kwargs: Command parameters
        
    Returns:
        True if sent successfully
    """
    body = {
        "request_id": request_id,
        **kwargs
    }
    return await send_message(ws, command_type, body)


async def broadcast(
    websockets: list,
    msg_type: str,
    body: dict,
    exclude: Optional[set] = None
) -> int:
    """
    Broadcast message to multiple WebSocket connections.
    
    Args:
        websockets: List of WebSocket connections
        msg_type: Message type
        body: Message body
        exclude: Set of WebSocket objects to exclude
        
    Returns:
        Number of successful sends
    """
    exclude = exclude or set()
    sent_count = 0
    
    tasks = []
    for ws in websockets:
        if ws not in exclude:
            tasks.append(send_message(ws, msg_type, body))
    
    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        sent_count = sum(1 for r in results if r is True)
    
    logger.debug(f"Broadcast '{msg_type}' to {sent_count}/{len(websockets)} clients")
    return sent_count


def _is_valid_envelope(data: dict) -> bool:
    """Check if data is already a valid Movesia message envelope."""
    required = ['v', 'source', 'type', 'ts', 'id']
    return all(k in data for k in required)


class MessageQueue:
    """
    Queue for outgoing messages with batching and retry support.
    
    Useful for high-throughput scenarios where messages need to be
    batched or retried on failure.
    """
    
    def __init__(
        self, 
        max_size: int = 1000,
        batch_size: int = 10,
        batch_delay: float = 0.1
    ):
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=max_size)
        self._batch_size = batch_size
        self._batch_delay = batch_delay
        self._running = False
        self._task: Optional[asyncio.Task] = None
    
    async def enqueue(self, ws: WebSocket, message: dict) -> bool:
        """
        Add message to the queue.
        
        Args:
            ws: Target WebSocket
            message: Message to send
            
        Returns:
            True if queued, False if queue is full
        """
        try:
            self._queue.put_nowait((ws, message))
            return True
        except asyncio.QueueFull:
            logger.warning("Message queue full, dropping message")
            return False
    
    def start(self, send_func: callable) -> None:
        """Start the queue processor."""
        if self._running:
            return
        
        self._running = True
        self._task = asyncio.create_task(self._process_loop(send_func))
    
    def stop(self) -> None:
        """Stop the queue processor."""
        self._running = False
        if self._task:
            self._task.cancel()
    
    async def _process_loop(self, send_func: callable) -> None:
        """Process queued messages."""
        while self._running:
            try:
                # Collect a batch
                batch = []
                
                try:
                    # Wait for first item
                    item = await asyncio.wait_for(
                        self._queue.get(), 
                        timeout=1.0
                    )
                    batch.append(item)
                    
                    # Try to get more items for batching
                    while len(batch) < self._batch_size:
                        try:
                            item = self._queue.get_nowait()
                            batch.append(item)
                        except asyncio.QueueEmpty:
                            break
                    
                except asyncio.TimeoutError:
                    continue
                
                # Send the batch
                for ws, message in batch:
                    try:
                        await send_func(ws, message)
                    except Exception as e:
                        logger.error(f"Failed to send queued message: {e}")
                
                # Brief delay between batches
                await asyncio.sleep(self._batch_delay)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in message queue: {e}")


class ReliableTransport:
    """
    Transport with delivery confirmation and retry.
    
    Tracks ACKs for messages that require confirmation and
    retries on timeout.
    """
    
    def __init__(
        self,
        ack_timeout: float = 5.0,
        max_retries: int = 3,
        retry_delay: float = 1.0
    ):
        self._ack_timeout = ack_timeout
        self._max_retries = max_retries
        self._retry_delay = retry_delay
        self._pending: dict[str, asyncio.Future] = {}
    
    async def send_reliable(
        self,
        ws: WebSocket,
        msg_type: str,
        body: dict
    ) -> bool:
        """
        Send message with delivery confirmation.
        
        Args:
            ws: WebSocket connection
            msg_type: Message type
            body: Message body
            
        Returns:
            True if ACK received, False otherwise
        """
        msg = MovesiaMessage.create(
            msg_type=msg_type,
            body=body,
            source=ConnectionSource.VSCODE
        )
        
        for attempt in range(self._max_retries):
            # Create future for ACK
            future: asyncio.Future = asyncio.get_event_loop().create_future()
            self._pending[msg.id] = future
            
            try:
                # Send message
                await send_to_client(ws, msg.to_dict())
                
                # Wait for ACK
                await asyncio.wait_for(future, self._ack_timeout)
                return True
                
            except asyncio.TimeoutError:
                logger.warning(
                    f"No ACK for message {msg.id}, attempt {attempt + 1}/{self._max_retries}"
                )
                if attempt < self._max_retries - 1:
                    await asyncio.sleep(self._retry_delay)
            finally:
                self._pending.pop(msg.id, None)
        
        return False
    
    def handle_ack(self, msg_id: str) -> bool:
        """
        Handle received ACK.
        
        Args:
            msg_id: ID of acknowledged message
            
        Returns:
            True if this was a pending ACK
        """
        future = self._pending.get(msg_id)
        if future and not future.done():
            future.set_result(True)
            return True
        return False
