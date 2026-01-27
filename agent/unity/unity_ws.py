"""
Unity WebSocket endpoint - Unity Editor connects here as CLIENT.

This endpoint handles:
- Connection acceptance and validation
- Session/connection sequence from query params
- Delegation to UnityManager for all connection logic
"""

import asyncio
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.responses import JSONResponse

from .unity_manager import UnityManager


router = APIRouter(tags=["Unity WebSocket"])

# These will be set by the main server module
_unity_manager: Optional[UnityManager] = None


def init_unity_routes(unity_manager: UnityManager) -> None:
    """Initialize route dependencies."""
    global _unity_manager
    _unity_manager = unity_manager


@router.websocket("/ws/unity")
async def unity_websocket_endpoint(
    websocket: WebSocket,
    session: Optional[str] = Query(None, description="Session identifier"),
    conn: int = Query(0, description="Connection sequence number for monotonic takeover")
) -> None:
    """
    WebSocket endpoint for Unity Editor.
    
    Unity connects here as a client when the Movesia package is loaded.
    
    Query Parameters:
        session: Optional session identifier. If not provided, will be
                 determined from handshake or auto-generated.
        conn: Connection sequence number. Newer connections (higher number)
              will supersede older connections for the same session.
    
    Protocol:
        1. Client connects with optional query params
        2. Client sends handshake JSON with project info
        3. Server sends welcome message
        4. Bidirectional message exchange using MovesiaMessage format
    
    Example handshake from Unity:
        {
            "project_path": "/path/to/unity/project",
            "unity_version": "2022.3.10f1",
            "session_id": "optional-override",
            "conn_seq": 1
        }
    """
    if _unity_manager is None:
        # This shouldn't happen if properly initialized
        await websocket.close(code=1011, reason="Server not initialized")
        return
    
    await _unity_manager.handle_connection(
        websocket=websocket,
        session_id=session,
        conn_seq=conn
    )


@router.get("/unity/status")
async def unity_status() -> JSONResponse:
    """
    Get Unity connection status.
    
    Returns:
        JSON with connection status information
    """
    if _unity_manager is None:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "message": "Server not initialized"}
        )
    
    return JSONResponse(content={
        "status": "connected" if _unity_manager.is_connected else "disconnected",
        "project": _unity_manager.current_project,
        "compiling": _unity_manager.is_compiling,
        "connections": _unity_manager.connection_count
    })


@router.post("/unity/command/{command_type}")
async def send_unity_command(
    command_type: str,
    body: dict
) -> JSONResponse:
    """
    Send a command to Unity (for testing/debugging).
    
    Args:
        command_type: Type of command (e.g., "query_hierarchy")
        body: Command parameters
        
    Returns:
        Response from Unity
    """
    if _unity_manager is None:
        raise HTTPException(status_code=503, detail="Server not initialized")
    
    if not _unity_manager.is_connected:
        raise HTTPException(status_code=503, detail="Unity not connected")
    
    try:
        result = await _unity_manager.send_and_wait(
            command_type=command_type,
            **body
        )
        return JSONResponse(content=result)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Command timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
