"""
Heartbeat Manager for WebSocket connection health monitoring.

Implements:
- Periodic health checks using ping/pong
- Idle connection detection and cleanup
- Compilation-aware suspension (critical for Unity)
- Latency measurement
- Graceful connection termination

The heartbeat is essential for:
1. Detecting silently dropped connections (no TCP RST received)
2. Keeping connections alive through NAT/proxies
3. Measuring connection quality (latency)
4. Cleaning up zombie connections
"""

import asyncio
import logging
import time
from typing import Optional, Callable, Awaitable, Set, Any
from dataclasses import dataclass

from .types import HeartbeatConfig, ExtendedConnection, ConnectionState


logger = logging.getLogger("movesia.heartbeat")


class HeartbeatManager:
    """
    Manages heartbeat/keepalive for WebSocket connections.
    
    Key features:
    - Configurable intervals and timeouts
    - Suspension during Unity compilation
    - Per-connection health tracking
    - Background task for periodic sweeps
    """
    
    def __init__(
        self, 
        config: Optional[HeartbeatConfig] = None,
        get_connections: Optional[Callable[[], Awaitable[dict]]] = None,
        send_ping: Optional[Callable[[Any, str], Awaitable[None]]] = None,
        close_connection: Optional[Callable[[Any, int, str], Awaitable[None]]] = None,
        now: Optional[Callable[[], float]] = None
    ):
        """
        Initialize heartbeat manager.
        
        Args:
            config: Heartbeat configuration
            get_connections: Async callback to get current connections (session_id -> entry)
            send_ping: Async callback to send ping to a websocket
            close_connection: Async callback to close a connection
            now: Time function (defaults to time.time, injectable for testing)
        """
        self.config = config or HeartbeatConfig()
        self._get_connections = get_connections
        self._send_ping = send_ping
        self._close_connection = close_connection
        self._now = now or time.time
        
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._suspend_until: float = 0
        
        # Track pending pings
        self._pending_pings: dict[str, float] = {}  # cid -> ping_sent_time
    
    def start(self) -> None:
        """Start the heartbeat background task."""
        if self._running:
            return
        
        self._running = True
        self._task = asyncio.create_task(self._heartbeat_loop())
    
    def stop(self) -> None:
        """Stop the heartbeat background task."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            self._task = None
    
    def suspend(self, duration_ms: int) -> None:
        """
        Suspend heartbeat checks for a duration.
        
        Use this during Unity compilation to avoid false disconnections.
        
        Args:
            duration_ms: How long to suspend in milliseconds
        """
        suspend_until = self._now() + (duration_ms / 1000)
        
        # Only extend, never shorten
        if suspend_until > self._suspend_until:
            self._suspend_until = suspend_until
    
    def is_suspended(self) -> bool:
        """Check if heartbeat is currently suspended."""
        return self._now() < self._suspend_until
    
    async def handle_pong(self, cid: str, connection: ExtendedConnection) -> None:
        """
        Handle pong receipt from a connection.
        
        Args:
            cid: Connection ID
            connection: Connection metadata to update
        """
        ping_time = self._pending_pings.pop(cid, None)
        if ping_time:
            connection.mark_pong_received(ping_time)
        else:
            # Unsolicited pong (unidirectional heartbeat from client)
            connection.update_seen()
    
    async def _heartbeat_loop(self) -> None:
        """Main heartbeat loop running in background."""
        sweep_interval = self.config.sweep_interval_ms / 1000
        
        while self._running:
            try:
                await asyncio.sleep(sweep_interval)
                
                if not self._running:
                    break
                
                # Skip sweep if suspended
                if self.is_suspended():
                    continue
                
                await self._sweep_connections()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in heartbeat loop: {e}", exc_info=True)
                await asyncio.sleep(1)  # Brief pause on error
    
    async def _sweep_connections(self) -> None:
        """Perform one heartbeat sweep over all connections."""
        if not self._get_connections:
            return
        
        now = self._now()
        connections = await self._get_connections()
        
        if not connections:
            return
        
        for session_id, entry in connections.items():
            try:
                await self._check_connection(session_id, entry, now)
            except Exception as e:
                logger.error(f"Error checking connection [{session_id}]: {e}")
    
    async def _check_connection(
        self, 
        session_id: str, 
        entry: Any,  # SessionEntry
        now: float
    ) -> None:
        """
        Check health of a single connection.
        
        Implements the state machine:
        1. CLOSING -> Force kill if stuck too long
        2. Active -> Skip if not idle enough
        3. Idle -> Send ping if is_alive
        4. Not responding -> Increment missed, terminate if too many
        """
        conn = entry.connection
        ws = entry.websocket
        
        # Handle connections stuck in CLOSING state
        if conn.state == ConnectionState.CLOSING:
            if conn.closing_since:
                closing_duration = now - conn.closing_since
                if closing_duration > (self.config.closing_force_kill_ms / 1000):
                    await self._terminate(ws, conn.cid)
            return
        
        # Only check OPEN connections
        if conn.state != ConnectionState.OPEN:
            return
        
        # Calculate idle time
        idle_ms = (now - conn.last_seen) * 1000
        
        # Check max idle - disconnect if too long
        if idle_ms > self.config.max_idle_ms:
            await self._close(ws, conn.cid, 1001, "idle timeout")
            return
        
        # Not idle enough for ping yet
        if idle_ms <= self.config.ping_after_idle_ms:
            conn.is_alive = True
            conn.missed_pongs = 0
            return
        
        # Connection is idle - check if we got response to last ping
        if not conn.is_alive:
            conn.missed_pongs += 1
            
            if conn.missed_pongs >= self.config.max_missed_pongs:
                await self._terminate(ws, conn.cid)
                return
        
        # Send ping
        conn.is_alive = False
        await self._send_ping_to(ws, conn.cid, now)
    
    async def _send_ping_to(self, ws: Any, cid: str, now: float) -> None:
        """Send a ping frame to a connection."""
        if not self._send_ping:
            return
        
        try:
            self._pending_pings[cid] = now
            await self._send_ping(ws, cid)
        except Exception as e:
            logger.error(f"Failed to send ping to [{cid}]: {e}")
            self._pending_pings.pop(cid, None)
    
    async def _close(self, ws: Any, cid: str, code: int, reason: str) -> None:
        """Close a connection gracefully."""
        if not self._close_connection:
            return
        
        try:
            await self._close_connection(ws, code, reason)
        except Exception as e:
            logger.error(f"Failed to close [{cid}]: {e}")
    
    async def _terminate(self, ws: Any, cid: str) -> None:
        """Forcefully terminate a connection."""
        self._pending_pings.pop(cid, None)
        await self._close(ws, cid, 1011, "terminated")


class ApplicationHeartbeat:
    """
    Application-level heartbeat for Unity connections.
    
    Unity's WebSocket libraries don't always support protocol-level ping/pong,
    so we implement an application-level heartbeat using regular messages.
    
    This sends/expects messages like:
    {
        "source": "vscode",
        "type": "hb",  // or "pong"
        "ts": 1234567890,
        "id": "...",
        "body": {}
    }
    """
    
    def __init__(
        self,
        config: Optional[HeartbeatConfig] = None,
        send_message: Optional[Callable[[Any, dict], Awaitable[None]]] = None
    ):
        self.config = config or HeartbeatConfig()
        self._send_message = send_message
        self._pending: dict[str, float] = {}  # msg_id -> sent_time
    
    async def send_heartbeat(self, ws: Any, msg_id: str) -> None:
        """Send an application-level heartbeat message."""
        if not self._send_message:
            return
        
        message = {
            "source": "vscode",
            "type": "hb",
            "ts": int(time.time()),
            "id": msg_id,
            "body": {}
        }
        
        self._pending[msg_id] = time.time()
        await self._send_message(ws, message)
    
    def handle_heartbeat_response(self, msg_id: str) -> Optional[float]:
        """
        Handle heartbeat response, return latency in ms if matched.
        
        Args:
            msg_id: Message ID from response
            
        Returns:
            Latency in milliseconds, or None if no matching ping
        """
        sent_time = self._pending.pop(msg_id, None)
        if sent_time:
            return (time.time() - sent_time) * 1000
        return None
    
    def clear_pending(self, msg_id: str) -> None:
        """Clear a pending heartbeat (e.g., on disconnect)."""
        self._pending.pop(msg_id, None)
    
    def clear_all_pending(self) -> None:
        """Clear all pending heartbeats."""
        self._pending.clear()
