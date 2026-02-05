"""
##############################################################################
#                                                                            #
#                         ⚠️  DEPRECATED - DO NOT USE  ⚠️                    #
#                                                                            #
#  This module is no longer used and is kept only for reference.             #
#  Chat WebSocket handling has been moved elsewhere.                         #
#                                                                            #
##############################################################################
"""

import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from database.repository import get_repository

logger = logging.getLogger("movesia.chat")

router = APIRouter(tags=["Chat WebSocket"])

# These will be set by the main server module
_chat_manager = None
_unity_manager = None
_stream_agent_response = None


def init_chat_routes(chat_manager, unity_manager, stream_agent_response_func):
    """Initialize route dependencies."""
    global _chat_manager, _unity_manager, _stream_agent_response
    _chat_manager = chat_manager
    _unity_manager = unity_manager
    _stream_agent_response = stream_agent_response_func


@router.websocket("/ws/chat/{session_id}")
async def chat_websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for VS Code chat sessions.
    Each chat session gets its own thread_id for conversation state.
    """
    await websocket.accept()
    await _chat_manager.register(session_id, websocket)

    short_id = session_id[:8]

    # Create/update conversation metadata in database
    repo = get_repository()
    conversation = await repo.get_or_create(
        session_id=session_id,
        unity_project_path=_unity_manager.current_project,
    )

    # LangGraph config with thread_id for conversation memory
    config = {"configurable": {"thread_id": session_id}}

    # Track if we need to update the title (first message)
    is_first_message = conversation.title is None

    # Send initial status
    await websocket.send_json({
        "type": "connected",
        "session_id": session_id,
        "unity_connected": _unity_manager.is_connected
    })

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "message":
                # User sent a chat message - run the agent
                user_message = data.get("content", "")

                # Set conversation title from first user message
                if is_first_message:
                    title = user_message[:100].strip()
                    if len(user_message) > 100:
                        title += "..."
                    await repo.update_title(session_id, title)
                    is_first_message = False
                else:
                    # Touch updated_at timestamp
                    await repo.touch(session_id)

                await _stream_agent_response(websocket, user_message, config)

            elif msg_type == "cancel":
                # User wants to cancel current operation
                # TODO: Implement cancellation if needed
                pass

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Chat error [{short_id}]: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass
    finally:
        await _chat_manager.unregister(session_id)
