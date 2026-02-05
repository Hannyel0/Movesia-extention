"""
Database engine and connection management.

Single SQLite database for:
- Conversation metadata (our table)
- LangGraph checkpoints (AsyncSqliteSaver tables)
"""

import os
import logging
from pathlib import Path
from typing import Optional

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
    AsyncEngine,
)

from .models import Base

logger = logging.getLogger("movesia.database")

# Global instances (initialized during startup)
_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None
_checkpoint_saver = None
_checkpoint_conn = None  # aiosqlite connection for checkpoint saver


def get_database_path() -> str:
    """
    Get the path to the SQLite database file.

    Uses DATABASE_PATH env var if set, otherwise defaults to
    'data/movesia.db' in the agent directory.
    """
    if db_path := os.getenv("DATABASE_PATH"):
        return db_path

    # Default: agent/data/movesia.db
    agent_dir = Path(__file__).parent.parent
    data_dir = agent_dir / "data"
    data_dir.mkdir(exist_ok=True)
    return str(data_dir / "movesia.db")


async def init_database() -> async_sessionmaker[AsyncSession]:
    """
    Initialize the database engine and create tables.

    Call this during FastAPI startup.
    Returns the session factory for dependency injection.
    """
    global _engine, _session_factory, _checkpoint_saver

    db_path = get_database_path()
    logger.info(f"Initializing database at: {db_path}")

    # Create async engine
    _engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        echo=False,
        connect_args={"check_same_thread": False},
    )

    # Create session factory
    _session_factory = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    # Create our tables
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    logger.info("Database tables created/verified")

    # Initialize LangGraph checkpoint saver (same database)
    global _checkpoint_conn
    try:
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        import aiosqlite

        # AsyncSqliteSaver.from_conn_string returns a context manager
        # We need to create the connection and saver manually
        _checkpoint_conn = await aiosqlite.connect(db_path)
        _checkpoint_saver = AsyncSqliteSaver(_checkpoint_conn)
        await _checkpoint_saver.setup()  # Create checkpoint tables
        logger.info("LangGraph AsyncSqliteSaver initialized (same DB)")
    except ImportError as e:
        logger.warning(
            f"langgraph-checkpoint-sqlite or aiosqlite not installed: {e}. "
            "Install with: pip install langgraph-checkpoint-sqlite aiosqlite"
        )
        from langgraph.checkpoint.memory import MemorySaver
        _checkpoint_saver = MemorySaver()
        logger.info("Falling back to MemorySaver (no persistence)")

    return _session_factory


async def close_database() -> None:
    """Close database connections gracefully."""
    global _engine, _session_factory, _checkpoint_saver, _checkpoint_conn

    if _checkpoint_conn:
        await _checkpoint_conn.close()
        logger.info("Checkpoint connection closed")

    if _engine:
        await _engine.dispose()
        logger.info("Database engine disposed")

    _engine = None
    _session_factory = None
    _checkpoint_saver = None
    _checkpoint_conn = None


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Get the session factory (must call init_database first)."""
    if _session_factory is None:
        raise RuntimeError("Database not initialized. Call init_database() first.")
    return _session_factory


def get_database() -> AsyncEngine:
    """Get the database engine (must call init_database first)."""
    if _engine is None:
        raise RuntimeError("Database not initialized. Call init_database() first.")
    return _engine


def get_checkpoint_saver():
    """Get the LangGraph checkpoint saver."""
    if _checkpoint_saver is None:
        raise RuntimeError("Database not initialized. Call init_database() first.")
    return _checkpoint_saver


class DatabaseSession:
    """
    Async context manager for database sessions.

    Usage:
        async with DatabaseSession() as session:
            result = await session.execute(query)
    """

    def __init__(self):
        self._session: Optional[AsyncSession] = None

    async def __aenter__(self) -> AsyncSession:
        factory = get_session_factory()
        self._session = factory()
        return self._session

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            if exc_type is not None:
                await self._session.rollback()
            await self._session.close()
