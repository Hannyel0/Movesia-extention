"""
Session Manager for WebSocket connections.

Implements monotonic takeover pattern where newer connections (higher conn_seq)
automatically supersede older connections for the same session.

This prevents issues with:
- Stale connections after network interruption
- Unity domain reload creating new connections
- Browser/client refresh while old connection lingers
"""

import asyncio
from typing import Dict, Optional, Tuple, Any
from dataclasses import dataclass
import logging

from .types import (
    ExtendedConnection, 
    SessionEntry, 
    ConnectionState,
    CloseCode
)


logger = logging.getLogger("movesia.sessions")


@dataclass
class AcceptDecision:
    """Result of session acceptance decision."""
    accept: bool
    supersede: Optional[Any] = None  # WebSocket to close
    reason: Optional[str] = None


class SessionManager:
    """
    Manages WebSocket sessions with monotonic takeover support.
    
    Key behaviors:
    - Each session (identified by session_id) can have at most one active connection
    - Newer connections (higher conn_seq) automatically supersede older ones
    - Older connection attempts are rejected immediately
    - Clean tracking and cleanup of session state
    """
    
    def __init__(self):
        self._sessions: Dict[str, SessionEntry] = {}
        self._lock = asyncio.Lock()
    
    async def accept(
        self, 
        session_id: str, 
        conn_seq: int, 
        connection: ExtendedConnection,
        websocket: Any
    ) -> AcceptDecision:
        """
        Evaluate whether to accept a new connection.
        
        Args:
            session_id: Unique session identifier
            conn_seq: Connection sequence number (monotonically increasing)
            connection: Extended connection metadata
            websocket: The FastAPI WebSocket object
            
        Returns:
            AcceptDecision with accept=True and optionally a websocket to supersede,
            or accept=False if connection should be rejected.
        """
        async with self._lock:
            existing = self._sessions.get(session_id)
            
            # No existing session - accept immediately
            if existing is None:
                self._sessions[session_id] = SessionEntry(
                    session_id=session_id,
                    conn_seq=conn_seq,
                    connection=connection,
                    websocket=websocket
                )
                short_id = session_id[:8] if session_id else "none"
                logger.info(f"Session accepted [{short_id}]")
                return AcceptDecision(accept=True)
            
            # Existing session with same or higher conn_seq - reject
            if conn_seq <= existing.conn_seq:
                short_id = session_id[:8] if session_id else "none"
                logger.warning(f"Rejected older connection [{short_id}] seq={conn_seq}")
                return AcceptDecision(
                    accept=False,
                    reason=f"Connection sequence {conn_seq} <= current {existing.conn_seq}"
                )
            
            # Newer connection - supersede the old one
            old_websocket = existing.websocket
            old_conn_seq = existing.conn_seq
            
            # Update the session entry
            self._sessions[session_id] = SessionEntry(
                session_id=session_id,
                conn_seq=conn_seq,
                connection=connection,
                websocket=websocket
            )
            
            short_id = session_id[:8] if session_id else "none"
            logger.info(f"Superseding connection [{short_id}] seq={old_conn_seq}→{conn_seq}")
            
            return AcceptDecision(accept=True, supersede=old_websocket)
    
    async def clear_if_match(
        self, 
        session_id: str, 
        websocket: Any
    ) -> bool:
        """
        Clear session entry only if the websocket matches.
        
        This prevents accidentally clearing a session that was
        already superseded by a newer connection.
        
        Args:
            session_id: Session to potentially clear
            websocket: WebSocket that must match
            
        Returns:
            True if session was cleared, False otherwise
        """
        async with self._lock:
            entry = self._sessions.get(session_id)
            if entry is not None and entry.websocket is websocket:
                del self._sessions[session_id]
                logger.info(f"Cleared session: {session_id}")
                return True
            return False
    
    async def get_session(self, session_id: str) -> Optional[SessionEntry]:
        """Get session entry by ID."""
        async with self._lock:
            return self._sessions.get(session_id)
    
    async def get_connection(self, session_id: str) -> Optional[ExtendedConnection]:
        """Get connection metadata for a session."""
        entry = await self.get_session(session_id)
        return entry.connection if entry else None
    
    async def get_websocket(self, session_id: str) -> Optional[Any]:
        """Get WebSocket for a session."""
        entry = await self.get_session(session_id)
        return entry.websocket if entry else None
    
    async def update_connection(
        self, 
        session_id: str, 
        **updates
    ) -> bool:
        """
        Update connection metadata for a session.
        
        Args:
            session_id: Session to update
            **updates: Fields to update on the ExtendedConnection
            
        Returns:
            True if session existed and was updated
        """
        async with self._lock:
            entry = self._sessions.get(session_id)
            if entry is None:
                return False
            
            for key, value in updates.items():
                if hasattr(entry.connection, key):
                    setattr(entry.connection, key, value)
            
            return True
    
    async def mark_seen(self, session_id: str) -> bool:
        """Mark session as having recent activity."""
        async with self._lock:
            entry = self._sessions.get(session_id)
            if entry:
                entry.connection.update_seen()
                return True
            return False
    
    async def get_all_sessions(self) -> Dict[str, SessionEntry]:
        """Get all active sessions (for iteration)."""
        async with self._lock:
            return dict(self._sessions)
    
    async def get_active_websockets(self) -> list:
        """Get all active WebSocket connections."""
        async with self._lock:
            return [
                entry.websocket 
                for entry in self._sessions.values()
                if entry.connection.state == ConnectionState.OPEN
            ]
    
    @property
    def size(self) -> int:
        """Number of active sessions."""
        return len(self._sessions)
    
    async def clear_all(self) -> int:
        """Clear all sessions. Returns count of cleared sessions."""
        async with self._lock:
            count = len(self._sessions)
            self._sessions.clear()
            logger.info(f"Cleared all {count} sessions")
            return count


class UnitySessionManager(SessionManager):
    """
    Extended session manager with Unity-specific functionality.
    
    Adds:
    - Project path tracking
    - Compilation state management
    - Unity version tracking
    """
    
    def __init__(self):
        super().__init__()
        self._project_to_session: Dict[str, str] = {}  # project_path -> session_id
    
    async def accept(
        self, 
        session_id: str, 
        conn_seq: int, 
        connection: ExtendedConnection,
        websocket: Any,
        project_path: Optional[str] = None
    ) -> AcceptDecision:
        """Accept with optional project path tracking."""
        decision = await super().accept(session_id, conn_seq, connection, websocket)
        
        if decision.accept and project_path:
            async with self._lock:
                # Clear old project mapping if exists
                old_session = self._project_to_session.get(project_path)
                if old_session and old_session != session_id:
                    logger.info(
                        f"Project {project_path} switching from session "
                        f"{old_session} to {session_id}"
                    )
                
                self._project_to_session[project_path] = session_id
                connection.project_path = project_path
        
        return decision
    
    async def get_session_for_project(
        self, 
        project_path: str
    ) -> Optional[SessionEntry]:
        """Get session by Unity project path."""
        async with self._lock:
            session_id = self._project_to_session.get(project_path)
            if session_id:
                return self._sessions.get(session_id)
            return None
    
    async def set_compiling(self, session_id: str, is_compiling: bool) -> bool:
        """Update compilation state for a session."""
        return await self.update_connection(session_id, is_compiling=is_compiling)
    
    async def clear_if_match(self, session_id: str, websocket: Any) -> bool:
        """Clear with project path cleanup."""
        async with self._lock:
            entry = self._sessions.get(session_id)
            if entry is not None and entry.websocket is websocket:
                # Clean up project mapping
                if entry.connection.project_path:
                    self._project_to_session.pop(
                        entry.connection.project_path, 
                        None
                    )
                
                del self._sessions[session_id]
                logger.info(f"Cleared Unity session: {session_id}")
                return True
            return False
    
    async def get_compiling_sessions(self) -> list:
        """Get all sessions currently in compilation state."""
        async with self._lock:
            return [
                entry 
                for entry in self._sessions.values()
                if entry.connection.is_compiling
            ]
