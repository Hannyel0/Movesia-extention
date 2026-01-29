"""
Unity Tools Package - The 6 Golden Tools for Unity Editor manipulation.

This package provides a clean interface for AI agents to interact with the Unity Editor
through WebSocket communication via the UnityManager.

Tools:
- unity_query: The Observer - read-only inspection
- unity_hierarchy: The Architect - scene graph structure
- unity_component: The Engineer - behavior and data
- unity_prefab: The Factory - templates and instances
- unity_scene: The Director - environment management
- unity_refresh: The Compiler - script compilation

Setup:
    Before using tools, register the Unity manager:

        from unity_tools import set_unity_manager
        set_unity_manager(unity_manager)
"""

from .connection import call_unity_async, set_unity_manager, get_unity_manager
from .query import unity_query
from .hierarchy import unity_hierarchy
from .component import unity_component
from .prefab import unity_prefab
from .scene import unity_scene
from .refresh import unity_refresh

# Export the 6 Golden Tools as a list for easy registration
unity_tools = [
    unity_query,      # The Observer - read-only inspection
    unity_hierarchy,  # The Architect - scene graph structure
    unity_component,  # The Engineer - behavior and data
    unity_prefab,     # The Factory - templates and instances
    unity_scene,      # The Director - environment management
    unity_refresh,    # The Compiler - script compilation
]

__all__ = [
    # Connection utilities
    "call_unity_async",
    "set_unity_manager",
    "get_unity_manager",
    # Individual tools
    "unity_query",
    "unity_hierarchy",
    "unity_component",
    "unity_prefab",
    "unity_scene",
    "unity_refresh",
    # Tool collection
    "unity_tools",
]
