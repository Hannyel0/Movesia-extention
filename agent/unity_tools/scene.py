"""
THE DIRECTOR: unity_scene
"I need to change the environment."
Consumes: create_scene, open_scene, save_scene, set_active_scene
"""
import json
from typing import Literal, Optional
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool

from .connection import call_unity_async


class SceneSchema(BaseModel):
    action: Literal["open", "save", "create", "set_active"] = Field(
        ..., description="The scene operation."
    )
    path: Optional[str] = Field(None, description="File path (Assets/Scenes/MyScene.unity).")
    additive: bool = Field(False, description="Open/Create additively (keep current scene loaded)?")


async def _unity_scene(
    action: Literal["open", "save", "create", "set_active"],
    path: Optional[str] = None,
    additive: bool = False
) -> str:
    """
    Manage Scene files. This is the "Director".

    Actions:
    - 'open': Load a scene (use additive=True to keep current scene).
    - 'save': Save the current scene (optionally to a new path).
    - 'create': Create a new scene file.
    - 'set_active': Set which loaded scene is the active scene.

    IMPORTANT: Always save before opening a new scene to avoid losing changes.
    """
    if action == "open":
        if path is None:
            return json.dumps({
                "error": "path is required for 'open'",
                "hint": "Provide the scene file path (relative to Assets folder)",
                "example": "unity_scene(action='open', path='Assets/Scenes/Level2.unity')"
            })
        result = await call_unity_async("open_scene", path=path, additive=additive)
    elif action == "save":
        params = {}
        if path:
            params["path"] = path
        result = await call_unity_async("save_scene", **params)
    elif action == "create":
        if path is None:
            return json.dumps({
                "error": "path is required for 'create'",
                "hint": "Provide the path for the new scene file (must end with .unity)",
                "example": "unity_scene(action='create', path='Assets/Scenes/NewLevel.unity')"
            })
        result = await call_unity_async("create_scene", savePath=path, additive=additive)
    elif action == "set_active":
        if path is None:
            return json.dumps({
                "error": "path is required for 'set_active'",
                "hint": "The scene must already be loaded (use additive=True when opening)",
                "example": "unity_scene(action='set_active', path='Assets/Scenes/Level2.unity')"
            })
        result = await call_unity_async("set_active_scene", path=path)
    else:
        result = {"error": f"Unknown action: {action}"}

    return json.dumps(result, indent=2)


# Create the async tool using StructuredTool
unity_scene = StructuredTool.from_function(
    coroutine=_unity_scene,
    name="unity_scene",
    description="""Manage Scene files. This is the "Director".

Actions:
- 'open': Load a scene (use additive=True to keep current scene).
- 'save': Save the current scene (optionally to a new path).
- 'create': Create a new scene file.
- 'set_active': Set which loaded scene is the active scene.

IMPORTANT: Always save before opening a new scene to avoid losing changes.""",
    args_schema=SceneSchema,
)
