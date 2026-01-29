"""
Shared connection utilities for Unity WebSocket communication.

This module provides the async bridge between LangGraph tools and the Unity WebSocket connection.
Tools call `call_unity_async()` which routes through the UnityManager's WebSocket.
"""
import json
import logging
from typing import Any, Optional

logger = logging.getLogger("movesia.unity_tools")

# Global reference to unity_manager - set during server startup
_unity_manager = None


def set_unity_manager(manager) -> None:
    """
    Set the global unity manager reference.
    Called from server.py during startup.
    """
    global _unity_manager
    _unity_manager = manager
    logger.info("Unity manager registered with tools")


def get_unity_manager():
    """Get the global unity manager instance."""
    return _unity_manager


async def call_unity_async(action: str, **params) -> dict:
    """
    Send a request to Unity via WebSocket and wait for response.

    Args:
        action: The Unity command type (e.g., 'get_hierarchy', 'create_gameobject')
        **params: Command parameters

    Returns:
        Response dict from Unity

    Raises:
        RuntimeError: If no Unity connection is available
    """
    if _unity_manager is None:
        raise RuntimeError("Unity manager not initialized. Tools cannot communicate with Unity.")

    if not _unity_manager.is_connected:
        return {
            "success": False,
            "error": "Unity is not connected. Please ensure Unity Editor is running and connected.",
            "hint": "Check that the Movesia plugin is installed in Unity and the WebSocket connection is established."
        }

    logger.debug(f"call_unity_async: action={action}, params={json.dumps(params)}")

    try:
        result = await _unity_manager.send_and_wait(action, **params)
        logger.debug(f"call_unity_async result: {str(result)[:200]}")
        return result
    except TimeoutError as e:
        logger.warning(f"Unity command timed out: {action}")
        return {
            "success": False,
            "error": f"Command timed out: {action}",
            "hint": "Unity may be busy (compiling, showing a dialog, etc.). Try again."
        }
    except RuntimeError as e:
        logger.error(f"Unity command failed: {action} - {e}")
        return {
            "success": False,
            "error": str(e)
        }
    except Exception as e:
        logger.error(f"Unexpected error in call_unity_async: {e}", exc_info=True)
        return {
            "success": False,
            "error": f"Unexpected error: {str(e)}"
        }
