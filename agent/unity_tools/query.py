"""
THE OBSERVER: unity_query
"I need to see what exists."
Consumes: get_hierarchy, get_components, get_project_settings, get_logs, search_assets
"""
import json
from typing import Literal, Optional
from pydantic import BaseModel, Field
from langchain_core.tools import tool

from .connection import call_unity


class QuerySchema(BaseModel):
    action: Literal["hierarchy", "inspect_object", "search_assets", "get_logs", "get_settings"] = Field(
        ..., description="The query type."
    )

    # Hierarchy params
    max_depth: int = Field(5, description="Depth for hierarchy traversal.")

    # Inspect params
    instance_id: Optional[int] = Field(None, description="Required for 'inspect_object'. The GameObject Instance ID.")

    # Search params
    search_query: Optional[str] = Field(None, description="Name/Label filter for 'search_assets'.")
    asset_type: Optional[str] = Field(None, description="Type filter (e.g., 'prefab', 'script') for 'search_assets'.")

    # Log params
    log_filter: Optional[str] = Field(None, description="'Error', 'Warning', or 'Exception'.")

    # Settings params
    settings_category: Optional[str] = Field(None, description="Settings category (e.g., 'physics', 'player', 'quality').")


@tool(args_schema=QuerySchema)
def unity_query(
    action: Literal["hierarchy", "inspect_object", "search_assets", "get_logs", "get_settings"],
    max_depth: int = 5,
    instance_id: Optional[int] = None,
    search_query: Optional[str] = None,
    asset_type: Optional[str] = None,
    log_filter: Optional[str] = None,
    settings_category: Optional[str] = None
) -> str:
    """
    Read the current state of the Unity Editor. This is the agent's "eyes".

    Actions:
    - 'hierarchy': See the scene tree structure.
    - 'inspect_object': Get components and properties of a specific object (Requires instance_id).
    - 'search_assets': Find prefabs, scripts, or assets in the project folders.
    - 'get_settings': Retrieve specific project settings.
    - 'get_logs': Check console for errors, warnings, or logs.
    """
    if action == "hierarchy":
        result = call_unity("get_hierarchy", maxDepth=max_depth)
    elif action == "inspect_object":
        if instance_id is None:
            return json.dumps({
                "error": "instance_id is required for 'inspect_object'",
                "hint": "First use unity_query(action='hierarchy') to find GameObject IDs",
                "example": "unity_query(action='inspect_object', instance_id=-74268)"
            })
        result = call_unity("get_components", instanceId=instance_id)
    elif action == "search_assets":
        result = call_unity("search_assets", name=search_query, type=asset_type)
    elif action == "get_logs":
        result = call_unity("get_logs", filter=log_filter)
    elif action == "get_settings":
        result = call_unity("get_project_settings", category=settings_category)
    else:
        result = {"error": f"Unknown action: {action}"}

    return json.dumps(result, indent=2)
