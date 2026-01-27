"""
THE ENGINEER: unity_component
"I need to change behavior and data."
Consumes: add_component, remove_component, modify_component
"""
import json
from typing import Literal, Optional
from pydantic import BaseModel, Field
from langchain_core.tools import tool

from .connection import call_unity


class ComponentSchema(BaseModel):
    action: Literal["add", "remove", "modify"] = Field(
        ..., description="The component operation."
    )

    # Target identifiers - two ways to target a component
    game_object_id: Optional[int] = Field(
        None,
        description="GameObject instance ID. Required for 'add'. For 'modify'/'remove', use with component_type as alternative to component_id."
    )
    component_type: Optional[str] = Field(
        None,
        description="Component type name (e.g., 'Transform', 'Rigidbody', 'BoxCollider'). Required for 'add'. For 'modify'/'remove', use with game_object_id."
    )
    component_id: Optional[int] = Field(
        None,
        description="Direct component instance ID. Alternative to game_object_id + component_type for 'modify'/'remove'."
    )
    component_index: int = Field(
        0,
        description="Index when multiple components of same type exist (default: 0 = first)."
    )

    # Properties for modify
    properties: Optional[dict] = Field(
        None,
        description="Properties to modify. Use array format for vectors: {'m_LocalPosition': [0, 5, 0]}"
    )


@tool(args_schema=ComponentSchema)
def unity_component(
    action: Literal["add", "remove", "modify"],
    game_object_id: Optional[int] = None,
    component_type: Optional[str] = None,
    component_id: Optional[int] = None,
    component_index: int = 0,
    properties: Optional[dict] = None
) -> str:
    """
    Edit components on GameObjects. This is the "Engineer".

    Actions:
    - 'add': Attach a component. Requires game_object_id + component_type.
    - 'modify': Change properties. Use EITHER component_id OR (game_object_id + component_type).
    - 'remove': Delete a component. Use EITHER component_id OR (game_object_id + component_type).

    RECOMMENDED WORKFLOW FOR MODIFY:
    Just use game_object_id + component_type - no need to inspect first!
    Example: unity_component(action='modify', game_object_id=-74268, component_type='Transform',
                            properties={'m_LocalPosition': [0, 5, 0]})

    PROPERTY FORMAT:
    - Vectors use ARRAYS: {'m_LocalPosition': [0, 5, 0]} ✓
    - NOT objects: {'m_LocalPosition': {'x': 0}} ✗

    Common types: Transform, Rigidbody, BoxCollider, SphereCollider, MeshRenderer, AudioSource, Light, Camera
    """
    if action == "add":
        if game_object_id is None:
            return json.dumps({
                "error": "game_object_id is required for 'add'",
                "hint": "First use unity_query(action='hierarchy') to find the GameObject ID",
                "example": "unity_component(action='add', game_object_id=-74268, component_type='Rigidbody')"
            })
        if component_type is None:
            return json.dumps({
                "error": "component_type is required for 'add'",
                "hint": "Specify the component type to add (e.g., Rigidbody, BoxCollider, AudioSource)",
                "example": "unity_component(action='add', game_object_id=-74268, component_type='Rigidbody')"
            })
        result = call_unity("add_component", instanceId=game_object_id, componentType=component_type)

    elif action == "modify":
        if properties is None:
            return json.dumps({
                "error": "properties is required for 'modify'",
                "hint": "Use array format for vectors: {'m_LocalPosition': [0, 5, 0]}",
                "example": "unity_component(action='modify', game_object_id=-74268, component_type='Transform', properties={'m_LocalPosition': [0, 5, 0]})"
            })

        # Build params - support both targeting methods
        params = {"properties": properties}

        if component_id is not None:
            # Direct component ID
            params["componentInstanceId"] = component_id
        elif game_object_id is not None and component_type is not None:
            # GameObject + type (agent-friendly!)
            params["gameObjectInstanceId"] = game_object_id
            params["componentType"] = component_type
            params["componentIndex"] = component_index
        else:
            return json.dumps({
                "error": "For 'modify', provide EITHER component_id OR (game_object_id + component_type)",
                "hint": "Easiest: use game_object_id + component_type, e.g., game_object_id=-74268, component_type='Transform'"
            })

        result = call_unity("modify_component", **params)

    elif action == "remove":
        # Build params - support both targeting methods
        if component_id is not None:
            result = call_unity("remove_component", componentInstanceId=component_id)
        elif game_object_id is not None and component_type is not None:
            result = call_unity("remove_component",
                              gameObjectInstanceId=game_object_id,
                              componentType=component_type,
                              componentIndex=component_index)
        else:
            return json.dumps({
                "error": "For 'remove', provide EITHER component_id OR (game_object_id + component_type)",
                "hint": "Easiest: use game_object_id + component_type from the hierarchy",
                "example": "unity_component(action='remove', game_object_id=-74268, component_type='Rigidbody')"
            })
    else:
        result = {"error": f"Unknown action: {action}"}

    return json.dumps(result, indent=2)
