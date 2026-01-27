"""
VS Code Chat Manager - Manages chat sessions with VS Code extension.
"""

from dataclasses import dataclass, field
from datetime import datetime
import asyncio
import logging

from fastapi import WebSocket

logger = logging.getLogger("movesia.chat")


@dataclass
class ChatSession:
    """Represents an active chat session."""
    session_id: str
    websocket: WebSocket
    created_at: datetime = field(default_factory=datetime.now)


class ChatManager:
    """Manages VS Code chat sessions."""

    def __init__(self):
        self._sessions: dict[str, ChatSession] = {}
        self._lock = asyncio.Lock()

    @property
    def session_count(self) -> int:
        return len(self._sessions)

    async def register(self, session_id: str, websocket: WebSocket):
        """Register a new chat session."""
        async with self._lock:
            self._sessions[session_id] = ChatSession(
                session_id=session_id,
                websocket=websocket
            )
            logger.info(f"Chat session started: {session_id}")

    async def unregister(self, session_id: str):
        """Unregister a chat session."""
        async with self._lock:
            self._sessions.pop(session_id, None)
            logger.info(f"Chat session ended: {session_id}")

    async def send(self, session_id: str, message: dict):
        """Send message to a specific session."""
        session = self._sessions.get(session_id)
        if session:
            try:
                await session.websocket.send_json(message)
            except Exception as e:
                logger.error(f"Failed to send to session {session_id}: {e}")

    def get_session(self, session_id: str) -> ChatSession | None:
        """Get a session by ID."""
        return self._sessions.get(session_id)
