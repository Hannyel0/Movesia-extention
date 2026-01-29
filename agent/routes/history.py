"""
REST API endpoints for chat history.

- Conversation metadata from our SQLite table
- Messages from LangGraph's checkpoint state
"""

import logging
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from database.repository import get_repository
from database.engine import get_checkpoint_saver

logger = logging.getLogger("movesia.history")

router = APIRouter(prefix="/api", tags=["History"])


# =============================================================================
# Response Models
# =============================================================================

class ConversationResponse(BaseModel):
    """Response model for a conversation."""
    id: str
    session_id: str
    title: Optional[str]
    unity_project_path: Optional[str]
    unity_version: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MessageResponse(BaseModel):
    """Response model for a message (from LangGraph state)."""
    role: str
    content: str


class ConversationDetailResponse(BaseModel):
    """Response model for conversation with messages."""
    conversation: ConversationResponse
    messages: List[MessageResponse]


class ConversationListResponse(BaseModel):
    """Response model for list of conversations."""
    conversations: List[ConversationResponse]
    total: int
    limit: int
    offset: int


# =============================================================================
# Endpoints
# =============================================================================

@router.get("/conversations", response_model=ConversationListResponse)
async def list_conversations(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """
    List all conversations, ordered by most recently updated.
    """
    repo = get_repository()
    conversations = await repo.list_all(limit=limit, offset=offset)

    return ConversationListResponse(
        conversations=[
            ConversationResponse(
                id=c.id,
                session_id=c.session_id,
                title=c.title,
                unity_project_path=c.unity_project_path,
                unity_version=c.unity_version,
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
            for c in conversations
        ],
        total=len(conversations),
        limit=limit,
        offset=offset,
    )


@router.get("/conversations/{session_id}", response_model=ConversationDetailResponse)
async def get_conversation(session_id: str):
    """
    Get a conversation by session ID with its messages.

    Messages are retrieved from LangGraph's checkpoint state.
    """
    repo = get_repository()

    conversation = await repo.get(session_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Get messages from LangGraph checkpoint
    messages = await _get_messages_from_checkpoint(session_id)

    return ConversationDetailResponse(
        conversation=ConversationResponse(
            id=conversation.id,
            session_id=conversation.session_id,
            title=conversation.title,
            unity_project_path=conversation.unity_project_path,
            unity_version=conversation.unity_version,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        ),
        messages=messages,
    )


@router.get("/conversations/{session_id}/messages", response_model=List[MessageResponse])
async def get_messages(session_id: str):
    """
    Get messages for a conversation from LangGraph state.
    """
    repo = get_repository()

    # Verify conversation exists
    conversation = await repo.get(session_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return await _get_messages_from_checkpoint(session_id)


@router.delete("/conversations/{session_id}")
async def delete_conversation(session_id: str):
    """
    Delete a conversation metadata entry.

    Note: This only deletes our metadata. LangGraph checkpoints
    would need separate cleanup if desired.
    """
    repo = get_repository()

    deleted = await repo.delete(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {"status": "ok", "message": "Conversation deleted"}


# =============================================================================
# Helper Functions
# =============================================================================

async def _get_messages_from_checkpoint(session_id: str) -> List[MessageResponse]:
    """
    Retrieve messages from LangGraph's checkpoint state.

    The checkpoint stores the full graph state including messages.
    """
    try:
        checkpointer = get_checkpoint_saver()
        config = {"configurable": {"thread_id": session_id}}

        # Get the latest checkpoint for this thread
        checkpoint = await checkpointer.aget(config)

        if not checkpoint:
            return []

        # Extract messages from checkpoint state
        # LangGraph stores messages in the 'channel_values' under 'messages'
        channel_values = checkpoint.get("channel_values", {})
        messages_data = channel_values.get("messages", [])

        messages = []
        for msg in messages_data:
            # Messages can be tuples like ("human", "content") or message objects
            if isinstance(msg, tuple) and len(msg) >= 2:
                role, content = msg[0], msg[1]
                messages.append(MessageResponse(
                    role=role if role != "human" else "user",
                    content=str(content)
                ))
            elif hasattr(msg, "type") and hasattr(msg, "content"):
                # LangChain message objects
                role = msg.type
                if role == "human":
                    role = "user"
                elif role == "ai":
                    role = "assistant"
                messages.append(MessageResponse(
                    role=role,
                    content=str(msg.content)
                ))

        return messages

    except Exception as e:
        logger.error(f"Failed to get messages from checkpoint: {e}")
        return []
