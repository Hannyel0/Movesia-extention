"""
REST API endpoints for chat history.

- Conversation metadata from our SQLite table
- Messages from LangGraph's checkpoint state
"""

import logging
from typing import List, Optional, Any, Dict
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


class ToolCallResponse(BaseModel):
    """Response model for a tool call."""
    id: str
    name: str
    input: Optional[Dict[str, Any]] = None
    output: Optional[Any] = None


class MessageResponse(BaseModel):
    """Response model for a message (from LangGraph state)."""
    role: str
    content: str
    tool_calls: Optional[List[ToolCallResponse]] = None


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
    Delete a conversation and its LangGraph checkpoints.
    """
    repo = get_repository()

    # Verify conversation exists
    conversation = await repo.get(session_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Delete LangGraph checkpoints for this thread
    try:
        checkpointer = get_checkpoint_saver()
        await checkpointer.adelete_thread(session_id)
        logger.info(f"Deleted checkpoints for thread: {session_id}")
    except Exception as e:
        logger.warning(f"Failed to delete checkpoints: {e}")
        # Continue anyway - we still want to delete the metadata

    # Delete our conversation metadata
    deleted = await repo.delete(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {"status": "ok", "message": "Conversation and messages deleted"}


# =============================================================================
# Helper Functions
# =============================================================================

async def _get_messages_from_checkpoint(session_id: str) -> List[MessageResponse]:
    """
    Retrieve messages from LangGraph's checkpoint state.

    The checkpoint stores the full graph state including messages.
    Tool calls are extracted from AIMessage and paired with ToolMessage outputs.
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

        # First pass: collect tool outputs from ToolMessages
        # Map tool_call_id -> output content
        tool_outputs: Dict[str, Any] = {}
        for msg in messages_data:
            if hasattr(msg, "type") and msg.type == "tool":
                # ToolMessage has tool_call_id and content (the output)
                tool_call_id = getattr(msg, "tool_call_id", None)
                if tool_call_id:
                    tool_outputs[tool_call_id] = msg.content

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

                # Skip tool messages - they're paired with AIMessage tool_calls
                if role == "tool":
                    continue

                if role == "human":
                    role = "user"
                elif role == "ai":
                    role = "assistant"

                # Extract text content (avoid stringifying tool call data)
                content = msg.content
                if isinstance(content, list):
                    # Content can be a list of blocks, extract text only
                    text_parts = []
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                        elif isinstance(block, str):
                            text_parts.append(block)
                    content = "".join(text_parts)
                elif not isinstance(content, str):
                    content = str(content) if content else ""

                # Extract tool calls from AIMessage
                tool_calls_response = None
                if role == "assistant" and hasattr(msg, "tool_calls") and msg.tool_calls:
                    tool_calls_response = []
                    for tc in msg.tool_calls:
                        tc_id = tc.get("id", "") if isinstance(tc, dict) else getattr(tc, "id", "")
                        tc_name = tc.get("name", "") if isinstance(tc, dict) else getattr(tc, "name", "")
                        tc_args = tc.get("args", {}) if isinstance(tc, dict) else getattr(tc, "args", {})

                        # Get the output from our collected tool outputs
                        tc_output = tool_outputs.get(tc_id)

                        tool_calls_response.append(ToolCallResponse(
                            id=tc_id,
                            name=tc_name,
                            input=tc_args if isinstance(tc_args, dict) else {},
                            output=tc_output
                        ))

                messages.append(MessageResponse(
                    role=role,
                    content=content,
                    tool_calls=tool_calls_response
                ))

        return messages

    except Exception as e:
        logger.error(f"Failed to get messages from checkpoint: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return []
