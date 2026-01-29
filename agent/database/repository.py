"""
Database repository for conversation metadata.

Messages and tool executions are handled by LangGraph's checkpointer.
This only manages thread/conversation metadata for listing and search.
"""

import logging
from datetime import datetime
from typing import Optional, List

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Conversation
from .engine import DatabaseSession

logger = logging.getLogger("movesia.database")


class ConversationRepository:
    """Repository for conversation metadata operations."""

    async def get_or_create(
        self,
        session_id: str,
        unity_project_path: Optional[str] = None,
        unity_version: Optional[str] = None,
    ) -> Conversation:
        """
        Get an existing conversation or create a new one.

        Called when a chat session starts to ensure we have metadata.
        """
        async with DatabaseSession() as session:
            result = await session.execute(
                select(Conversation).where(Conversation.session_id == session_id)
            )
            conversation = result.scalar_one_or_none()

            if conversation:
                # Update metadata if provided
                if unity_project_path and not conversation.unity_project_path:
                    conversation.unity_project_path = unity_project_path
                if unity_version and not conversation.unity_version:
                    conversation.unity_version = unity_version
                conversation.updated_at = datetime.utcnow()
                await session.commit()
                return conversation

            # Create new
            conversation = Conversation(
                session_id=session_id,
                unity_project_path=unity_project_path,
                unity_version=unity_version,
            )
            session.add(conversation)
            await session.commit()
            await session.refresh(conversation)

            logger.info(f"Created conversation: {conversation.id[:8]} for session {session_id[:8]}")
            return conversation

    async def get(self, session_id: str) -> Optional[Conversation]:
        """Get a conversation by session_id."""
        async with DatabaseSession() as session:
            result = await session.execute(
                select(Conversation).where(Conversation.session_id == session_id)
            )
            return result.scalar_one_or_none()

    async def list_all(
        self,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Conversation]:
        """List conversations, ordered by most recently updated."""
        async with DatabaseSession() as session:
            result = await session.execute(
                select(Conversation)
                .order_by(Conversation.updated_at.desc())
                .limit(limit)
                .offset(offset)
            )
            return list(result.scalars().all())

    async def update_title(self, session_id: str, title: str) -> None:
        """Update conversation title (auto-generated from first user message)."""
        async with DatabaseSession() as session:
            await session.execute(
                update(Conversation)
                .where(Conversation.session_id == session_id)
                .values(title=title[:500], updated_at=datetime.utcnow())
            )
            await session.commit()

    async def touch(self, session_id: str) -> None:
        """Update the updated_at timestamp (call on each message)."""
        async with DatabaseSession() as session:
            await session.execute(
                update(Conversation)
                .where(Conversation.session_id == session_id)
                .values(updated_at=datetime.utcnow())
            )
            await session.commit()

    async def delete(self, session_id: str) -> bool:
        """Delete a conversation. Returns True if deleted."""
        async with DatabaseSession() as session:
            result = await session.execute(
                select(Conversation).where(Conversation.session_id == session_id)
            )
            conversation = result.scalar_one_or_none()

            if conversation:
                await session.delete(conversation)
                await session.commit()
                return True
            return False


# Global repository instance
_repository: Optional[ConversationRepository] = None


def get_repository() -> ConversationRepository:
    """Get the global repository instance."""
    global _repository
    if _repository is None:
        _repository = ConversationRepository()
    return _repository
