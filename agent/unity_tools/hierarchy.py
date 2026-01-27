"""
THE ARCHITECT: unity_hierarchy
"I need to organize the Scene Graph."
Consumes: create_gameobject, duplicate_gameobject, destroy_gameobject,
          rename_gameobject, set_parent, move_to_scene
"""
import json
from typing import Literal, Optional, List
from pydantic import BaseModel, Field
from langchain_core.tools import tool

from .connection import call_unity


class HierarchySchema(BaseModel):
    action: Literal["create", "duplicate", "destroy", "rename", "reparent", "move_scene"] = Field(
        ..., description="The hierarchy manipulation action."
    )

    # Target
    instance_id: Optional[int] = Field(None, description="The object to manipulate.")

    # Create params
    name: Optional[str] = Field(None, description="New name (for create/rename).")
    primitive_type: Optional[str] = Field(None, description="Optional primitive (Cube, Sphere, Capsule, Cylinder, Plane, Quad) for 'create'.")

    # Positioning
    parent_id: Optional[int] = Field(None, description="Parent ID for create/reparent.")
    position: Optional[List[float]] = Field(None, description="[x, y, z] for creation.")
    target_scene: Optional[str] = Field(None, description="Scene name for 'move_scene'.")


@tool(args_schema=HierarchySchema)
def unity_hierarchy(
    action: Literal["create", "duplicate", "destroy", "rename", "reparent", "move_scene"],
    instance_id: Optional[int] = None,
    name: Optional[str] = None,
    primitive_type: Optional[str] = None,
    parent_id: Optional[int] = None,
    position: Optional[List[float]] = None,
    target_scene: Optional[str] = None
) -> str:
    """
    Manage GameObject structure in the scene hierarchy. This is the "Architect".

    Actions:
    - 'create': Make new empty objects or primitives (Cube, Sphere, etc.).
    - 'duplicate': Clone an existing GameObject.
    - 'destroy': Remove objects (Undo supported).
    - 'rename': Change a GameObject's name.
    - 'reparent': Move objects in the hierarchy tree.
    - 'move_scene': Move root objects between loaded scenes.
    """
    api_map = {
        "create": "create_gameobject",
        "duplicate": "duplicate_gameobject",
        "destroy": "destroy_gameobject",
        "rename": "rename_gameobject",
        "reparent": "set_parent",
        "move_scene": "move_to_scene"
    }

    # Build params based on action
    params = {}

    if action == "create":
        if name:
            params["name"] = name
        if primitive_type:
            params["primitiveType"] = primitive_type
        if parent_id is not None:
            params["parentInstanceId"] = parent_id
        if position:
            params["position"] = position
    elif action == "duplicate":
        if instance_id is None:
            return json.dumps({
                "error": "instance_id is required for 'duplicate'",
                "hint": "First use unity_query(action='hierarchy') to find the GameObject ID",
                "example": "unity_hierarchy(action='duplicate', instance_id=-74268)"
            })
        params["instanceId"] = instance_id
    elif action == "destroy":
        if instance_id is None:
            return json.dumps({
                "error": "instance_id is required for 'destroy'",
                "hint": "First use unity_query(action='hierarchy') to find the GameObject ID",
                "example": "unity_hierarchy(action='destroy', instance_id=-74268)"
            })
        params["instanceId"] = instance_id
    elif action == "rename":
        if instance_id is None:
            return json.dumps({
                "error": "instance_id is required for 'rename'",
                "hint": "First use unity_query(action='hierarchy') to find the GameObject ID",
                "example": "unity_hierarchy(action='rename', instance_id=-74268, name='NewName')"
            })
        if name is None:
            return json.dumps({
                "error": "name is required for 'rename'",
                "hint": "Provide the new name for the GameObject",
                "example": "unity_hierarchy(action='rename', instance_id=-74268, name='Player')"
            })
        params["instanceId"] = instance_id
        params["name"] = name
    elif action == "reparent":
        if instance_id is None:
            return json.dumps({
                "error": "instance_id is required for 'reparent'",
                "hint": "First use unity_query(action='hierarchy') to find both object IDs",
                "example": "unity_hierarchy(action='reparent', instance_id=-74268, parent_id=-12345)"
            })
        params["instanceId"] = instance_id
        params["parentInstanceId"] = parent_id  # None means move to root
    elif action == "move_scene":
        if instance_id is None:
            return json.dumps({
                "error": "instance_id is required for 'move_scene'",
                "hint": "First use unity_query(action='hierarchy') to find the GameObject ID",
                "example": "unity_hierarchy(action='move_scene', instance_id=-74268, target_scene='Level2')"
            })
        if target_scene is None:
            return json.dumps({
                "error": "target_scene is required for 'move_scene'",
                "hint": "Provide the name of the destination scene",
                "example": "unity_hierarchy(action='move_scene', instance_id=-74268, target_scene='Level2')"
            })
        params["instanceId"] = instance_id
        params["sceneName"] = target_scene

    result = call_unity(api_map[action], **params)
    return json.dumps(result, indent=2)
