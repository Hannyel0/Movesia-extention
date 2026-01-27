"""
Chat WebSocket endpoint - VS Code extension connects here.
"""

import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

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
    logger.info(f"Chat connected [{short_id}]")

    # LangGraph config with thread_id for conversation memory
    config = {"configurable": {"thread_id": session_id}}

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
                preview = user_message[:50] + "..." if len(user_message) > 50 else user_message
                logger.info(f"Message [{short_id}]: {preview}")
                await _stream_agent_response(websocket, user_message, config)

            elif msg_type == "cancel":
                # User wants to cancel current operation
                # TODO: Implement cancellation if needed
                pass

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info(f"Chat disconnected [{short_id}]")
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
