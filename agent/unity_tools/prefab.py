"""
THE FACTORY: unity_prefab
"I need to use or create templates."
Consumes: instantiate_prefab, instantiate_prefab_by_name, create_prefab,
          modify_prefab, revert_prefab, apply_prefab
"""
import json
from typing import Literal, Optional, List
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool

from .connection import call_unity_async


class PrefabSchema(BaseModel):
    action: Literal["instantiate", "instantiate_by_name", "create_asset", "modify_asset", "apply", "revert"] = Field(
        ..., description="The prefab operation."
    )

    # Asset paths/Names
    asset_path: Optional[str] = Field(None, description="Path to .prefab file (e.g., 'Assets/Prefabs/Player.prefab').")
    prefab_name: Optional[str] = Field(None, description="Name for 'instantiate_by_name'.")

    # Instance Targets
    instance_id: Optional[int] = Field(None, description="Scene Instance ID for apply/revert/create_asset.")

    # Positioning
    position: Optional[List[float]] = Field([0, 0, 0], description="Spawn position [x, y, z].")
    rotation: Optional[List[float]] = Field(None, description="Spawn rotation [x, y, z] in euler angles.")

    # Asset Modification
    component_type: Optional[str] = Field(None, description="Component to edit on the prefab ASSET directly.")
    properties: Optional[dict] = Field(None, description="Properties to edit on the prefab ASSET.")


async def _unity_prefab(
    action: Literal["instantiate", "instantiate_by_name", "create_asset", "modify_asset", "apply", "revert"],
    asset_path: Optional[str] = None,
    prefab_name: Optional[str] = None,
    instance_id: Optional[int] = None,
    position: Optional[List[float]] = None,
    rotation: Optional[List[float]] = None,
    component_type: Optional[str] = None,
    properties: Optional[dict] = None
) -> str:
    """
    Manage Prefab Assets and Instances. This is the "Factory".

    Actions:
    - 'instantiate': Spawn a prefab into the scene by asset path.
    - 'instantiate_by_name': Search and spawn by name (easiest way to spawn known assets).
    - 'create_asset': Create a new prefab from a scene GameObject.
    - 'modify_asset': Edit the .prefab file directly without opening it.
    - 'apply': Push scene instance changes back to the prefab asset.
    - 'revert': Reset scene instance to match the prefab asset.

    Use 'instantiate_by_name' when you know the prefab name but not the exact path.
    """
    if position is None:
        position = [0, 0, 0]

    if action == "instantiate":
        if asset_path is None:
            return json.dumps({
                "error": "asset_path is required for 'instantiate'",
                "hint": "Use 'instantiate_by_name' if you only know the prefab name, or search with unity_query(action='search_assets')",
                "example": "unity_prefab(action='instantiate', asset_path='Assets/Prefabs/Enemy.prefab', position=[0, 0, 5])"
            })
        params = {"assetPath": asset_path, "position": position}
        if rotation:
            params["rotation"] = rotation
        result = await call_unity_async("instantiate_prefab", **params)
    elif action == "instantiate_by_name":
        if prefab_name is None:
            return json.dumps({
                "error": "prefab_name is required for 'instantiate_by_name'",
                "hint": "Provide the prefab name (without path or .prefab extension)",
                "example": "unity_prefab(action='instantiate_by_name', prefab_name='Enemy', position=[0, 0, 5])"
            })
        params = {"prefabName": prefab_name, "position": position}
        if rotation:
            params["rotation"] = rotation
        result = await call_unity_async("instantiate_prefab_by_name", **params)
    elif action == "create_asset":
        if instance_id is None:
            return json.dumps({
                "error": "instance_id is required for 'create_asset'",
                "hint": "First use unity_query(action='hierarchy') to find the GameObject ID to turn into a prefab",
                "example": "unity_prefab(action='create_asset', instance_id=-74268, asset_path='Assets/Prefabs/NewPrefab.prefab')"
            })
        if asset_path is None:
            return json.dumps({
                "error": "asset_path is required for 'create_asset'",
                "hint": "Specify where to save the new prefab (must end with .prefab)",
                "example": "unity_prefab(action='create_asset', instance_id=-74268, asset_path='Assets/Prefabs/NewPrefab.prefab')"
            })
        result = await call_unity_async("create_prefab", instanceId=instance_id, savePath=asset_path)
    elif action == "modify_asset":
        if asset_path is None:
            return json.dumps({
                "error": "asset_path is required for 'modify_asset'",
                "hint": "Use unity_query(action='search_assets', asset_type='prefab') to find prefab paths",
                "example": "unity_prefab(action='modify_asset', asset_path='Assets/Prefabs/Enemy.prefab', component_type='Transform', properties={'m_LocalScale': [2, 2, 2]})"
            })
        if component_type is None:
            return json.dumps({
                "error": "component_type is required for 'modify_asset'",
                "hint": "Specify which component on the prefab to modify",
                "example": "unity_prefab(action='modify_asset', asset_path='Assets/Prefabs/Enemy.prefab', component_type='Transform', properties={'m_LocalScale': [2, 2, 2]})"
            })
        if properties is None:
            return json.dumps({
                "error": "properties is required for 'modify_asset'",
                "hint": "Use array format for vectors: {'m_LocalScale': [2, 2, 2]}",
                "example": "unity_prefab(action='modify_asset', asset_path='Assets/Prefabs/Enemy.prefab', component_type='Transform', properties={'m_LocalScale': [2, 2, 2]})"
            })
        result = await call_unity_async("modify_prefab", assetPath=asset_path, componentType=component_type, properties=properties)
    elif action == "apply":
        if instance_id is None:
            return json.dumps({
                "error": "instance_id is required for 'apply'",
                "hint": "First use unity_query(action='hierarchy') to find the prefab instance ID in the scene",
                "example": "unity_prefab(action='apply', instance_id=-74268)"
            })
        result = await call_unity_async("apply_prefab", instanceId=instance_id)
    elif action == "revert":
        if instance_id is None:
            return json.dumps({
                "error": "instance_id is required for 'revert'",
                "hint": "First use unity_query(action='hierarchy') to find the prefab instance ID in the scene",
                "example": "unity_prefab(action='revert', instance_id=-74268)"
            })
        result = await call_unity_async("revert_prefab", instanceId=instance_id)
    else:
        result = {"error": f"Unknown action: {action}"}

    return json.dumps(result, indent=2)


# Create the async tool using StructuredTool
unity_prefab = StructuredTool.from_function(
    coroutine=_unity_prefab,
    name="unity_prefab",
    description="""Manage Prefab Assets and Instances. This is the "Factory".

Actions:
- 'instantiate': Spawn a prefab into the scene by asset path.
- 'instantiate_by_name': Search and spawn by name (easiest way to spawn known assets).
- 'create_asset': Create a new prefab from a scene GameObject.
- 'modify_asset': Edit the .prefab file directly without opening it.
- 'apply': Push scene instance changes back to the prefab asset.
- 'revert': Reset scene instance to match the prefab asset.

Use 'instantiate_by_name' when you know the prefab name but not the exact path.""",
    args_schema=PrefabSchema,
)
