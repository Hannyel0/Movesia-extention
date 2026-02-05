"""
Database module for Movesia Agent.

Provides:
- Conversation metadata storage (for listing threads)
- LangGraph checkpoints (messages stored automatically)
"""

from .models import Base, Conversation
from .repository import ConversationRepository, get_repository
from .engine import (
    init_database,
    close_database,
    get_database,
    get_checkpoint_saver,
    get_database_path,
)

__all__ = [
    # Models
    "Base",
    "Conversation",
    # Repository
    "ConversationRepository",
    "get_repository",
    # Engine
    "init_database",
    "close_database",
    "get_database",
    "get_checkpoint_saver",
    "get_database_path",
]
