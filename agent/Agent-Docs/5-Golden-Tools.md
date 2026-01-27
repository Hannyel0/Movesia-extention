### The 5 Golden Tools Architecture

### 1. The Observer: unity_query

**Intent:** "I need to see what exists."

**Consumes APIs:** get_hierarchy, get_components, get_project_settings, get_logs, search_assets.

This is the agent's "eyes." It combines all read-only operations.

codePython

```csharp
class QuerySchema(BaseModel):
    action: Literal["hierarchy", "inspect_object", "search_assets", "get_logs", "get_settings"] = Field(..., description="The query type.")

    # Hierarchy params
    max_depth: int = Field(5, description="Depth for hierarchy traversal.")

    # Inspect params
    instance_id: Optional[int] = Field(None, description="Required for 'inspect_object'. The GameObject Instance ID.")

    # Search params
    search_query: Optional[str] = Field(None, description="Name/Label filter for 'search_assets'.")
    asset_type: Optional[str] = Field(None, description="Type filter (e.g., 'prefab', 'script') for 'search_assets'.")

    # Log params
    log_filter: Optional[str] = Field(None, description="'Error', 'Warning', or 'Exception'.")

@tool(args_schema=QuerySchema)
def unity_query(action: str, **kwargs):
    """
    Read the current state of the Unity Editor.
    - 'hierarchy': See the scene tree.
    - 'inspect_object': Get components and properties of a specific object (Requires instance_id).
    - 'search_assets': Find prefabs, scripts, or assets in the project folders.
    - 'get_settings': specific project settings.
    - 'get_logs': Check console for errors.
    """
    if action == "hierarchy":
        return call_unity("get_hierarchy", maxDepth=kwargs.get("max_depth", 5))
    elif action == "inspect_object":
        return call_unity("get_components", instanceId=kwargs.get("instance_id"))
    elif action == "search_assets":
        return call_unity("search_assets", name=kwargs.get("search_query"), type=kwargs.get("asset_type"))
    # ... handle others
```

### 2. The Architect: unity_hierarchy

**Intent:** "I need to organize the Scene Graph."

**Consumes APIs:** create_gameobject, duplicate_gameobject, destroy_gameobject, rename_gameobject, set_parent, move_to_scene.

This manages the *existence* and *location* of objects.

```csharp
class HierarchySchema(BaseModel):
    action: Literal["create", "duplicate", "destroy", "rename", "reparent", "move_scene"] = Field(...)

    # Target
    instance_id: Optional[int] = Field(None, description="The object to manipulate.")

    # Create params
    name: Optional[str] = Field(None, description="New name (for create/rename).")
    primitive_type: Optional[str] = Field(None, description="Optional primitive (Cube, Sphere) for 'create'.")

    # Positioning
    parent_id: Optional[int] = Field(None, description="Parent ID for create/reparent.")
    position: Optional[list[float]] = Field(None, description="[x,y,z] for creation.")
    target_scene: Optional[str] = Field(None, description="Scene name for 'move_scene'.")

@tool(args_schema=HierarchySchema)
def unity_hierarchy(action: str, **kwargs):
    """
    Manage GameObject structure.
    - 'create': Make new empty objects or primitives.
    - 'reparent': Move objects in the hierarchy tree.
    - 'destroy': Remove objects (Undo supported).
    - 'move_scene': Move root objects between loaded scenes.
    """
    # Map actions to specific API calls
    api_map = {
        "create": "create_gameobject",
        "duplicate": "duplicate_gameobject",
        "destroy": "destroy_gameobject",
        "rename": "rename_gameobject",
        "reparent": "set_parent",
        "move_scene": "move_to_scene"
    }
    return call_unity(api_map[action], **kwargs)
```

### 3. The Engineer: unity_component

**Intent:** "I need to change behavior and data."

**Consumes APIs:** add_component, remove_component, modify_component.

This is where the magic happens (Logic, Physics, Audio).

```csharp
class ComponentSchema(BaseModel):
    action: Literal["add", "remove", "modify"] = Field(...)

    # Targets
    game_object_id: Optional[int] = Field(None, description="GameObject ID (for add).")
    component_id: Optional[int] = Field(None, description="Component ID (for remove/modify). Get this from 'inspect_object'.")

    # Data
    component_type: Optional[str] = Field(None, description="Type to add (e.g., 'Rigidbody').")
    properties: Optional[dict] = Field(None, description="Dictionary of properties to modify (e.g., {'m_Mass': 5.0}).")

@tool(args_schema=ComponentSchema)
def unity_component(action: str, **kwargs):
    """
    Edit logic and properties.
    - 'add': Attach scripts or components to a GameObject.
    - 'modify': Change values. Use 'inspect_object' first to find property names (usually start with 'm_').
    - 'remove': Delete a component.
    """
    if action == "add":
        return call_unity("add_component", instanceId=kwargs.get("game_object_id"), componentType=kwargs.get("component_type"))
    elif action == "modify":
        return call_unity("modify_component", componentInstanceId=kwargs.get("component_id"), properties=kwargs.get("properties"))
    elif action == "remove":
        return call_unity("remove_component", componentInstanceId=kwargs.get("component_id"))
```

### 4. The Factory: unity_prefab

**Intent:** "I need to use or create templates."

**Consumes APIs:** instantiate_prefab, instantiate_prefab_by_name, create_prefab, modify_prefab, revert_prefab, apply_prefab.

Crucial for distinguishing between "creating a Cube" (Hierarchy tool) and "Spawning an Enemy" (Prefab tool).

```csharp
class PrefabSchema(BaseModel):
    action: Literal["instantiate", "instantiate_by_name", "create_asset", "modify_asset", "apply", "revert"] = Field(...)

    # Asset paths/Names
    asset_path: Optional[str] = Field(None, description="Path to .prefab file (e.g., 'Assets/Prefabs/Player.prefab').")
    prefab_name: Optional[str] = Field(None, description="Name for 'instantiate_by_name'.")

    # Instance Targets
    instance_id: Optional[int] = Field(None, description="Scene Instance ID for apply/revert/create_asset.")

    # Positioning
    position: Optional[list[float]] = Field([0,0,0], description="Spawn position.")

    # Asset Modification
    component_type: Optional[str] = Field(None, description="Component to edit on the prefab ASSET directly.")
    properties: Optional[dict] = Field(None, description="Properties to edit on the prefab ASSET.")

@tool(args_schema=PrefabSchema)
def unity_prefab(action: str, **kwargs):
    """
    Manage Prefab Assets and Instances.
    - 'instantiate': Spawn a prefab into the scene.
    - 'instantiate_by_name': Search and spawn (easiest way to spawn known assets).
    - 'apply'/'revert': Sync scene changes to/from the prefab asset.
    - 'modify_asset': Edit the .prefab file directly without opening it.
    """
    # Logic to route to specific APIs...
    pass
```

### 5. The Director: unity_scene

**Intent:** "I need to change the environment."

**Consumes APIs:** create_scene, open_scene, save_scene, set_active_scene.

```csharp
class SceneSchema(BaseModel):
    action: Literal["open", "save", "create", "set_active"] = Field(...)
    path: Optional[str] = Field(None, description="File path (Assets/Scenes/...).")
    additive: bool = Field(False, description="Open/Create additively?")

@tool(args_schema=SceneSchema)
def unity_scene(action: str, **kwargs):
    """
    Manage Scene files.
    - Always save before opening a new scene.
    """
    # Logic to route to APIs...
    pass
```

##
