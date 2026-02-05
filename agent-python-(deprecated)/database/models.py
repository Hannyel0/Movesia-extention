"""
SQLAlchemy models for Movesia Agent database.

Only stores thread/conversation metadata.
Messages and tool executions are automatically handled by LangGraph's checkpointer.
"""

from datetime import datetime
import uuid

from sqlalchemy import Column, String, DateTime, Index
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""
    pass


def generate_uuid() -> str:
    """Generate a new UUID string."""
    return str(uuid.uuid4())


class Conversation(Base):
    """
    Thread metadata for chat conversations.

    The actual messages are stored by LangGraph's AsyncSqliteSaver.
    This table only stores metadata for listing/searching threads.
    """
    __tablename__ = "conversations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(255), unique=True, nullable=False, index=True)

    # Metadata
    title = Column(String(500), nullable=True)  # Auto-generated from first message
    unity_project_path = Column(String(1000), nullable=True)
    unity_version = Column(String(50), nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_conversations_updated_at", "updated_at"),
    )

    def __repr__(self):
        return f"<Conversation(id={self.id[:8]}, session={self.session_id[:8]}, title='{self.title}')>"
