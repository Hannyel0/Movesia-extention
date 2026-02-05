"""
THE COMPILER: unity_refresh
"I need to compile my code."
Consumes: refresh_assets

Note: This tool uses LangGraph's interrupt() to pause execution while Unity compiles.
The interrupt is handled by the agent harness which communicates with Unity via WebSocket.
"""
import json
from typing import Optional, List
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool
from langgraph.types import interrupt


class RefreshSchema(BaseModel):
    watched_scripts: Optional[List[str]] = Field(
        None,
        description="List of specific script names (e.g. ['PlayerController']) to verify existence of after compilation."
    )
    type_limit: int = Field(
        20,
        description="Limit the number of returned available types to save tokens."
    )


def _unity_refresh(watched_scripts: Optional[List[str]] = None, type_limit: int = 20) -> str:
    """
    Trigger Unity Asset Database refresh and Script Compilation.
    This is "The Compiler".

    CRITICAL: You MUST use this tool after creating or editing C# scripts (.cs files).
    Unity cannot add a component until the script is compiled.

    Behavior:
    1. Pauses agent execution while Unity compiles (handled by orchestrator).
    2. Returns 'compilationErrors' if syntax errors exist.
    3. Confirms if 'watched_scripts' are now valid components.
    """

    # ---------------------------------------------------------
    # BUILD THE REQUEST (will be sent to Unity by harness)
    # ---------------------------------------------------------
    params = {"typeLimit": type_limit}
    if watched_scripts:
        params["watchedScripts"] = watched_scripts

    compile_request = {
        "action": "refresh_assets",
        "params": params
    }

    # ---------------------------------------------------------
    # INTERRUPT: Pause agent, let harness call Unity via WebSocket
    # ---------------------------------------------------------
    # The harness catches this, sends command to Unity via WebSocket,
    # waits for compilation to complete, then resumes with Unity's response
    print(f"DEBUG: Pausing for compilation... request={compile_request}")
    result = interrupt(compile_request)  # <-- Returns Unity's response after resume
    print(f"DEBUG: Resumed from compilation. result={result}")

    # ---------------------------------------------------------
    # HANDLE TIMEOUT - Tell agent to check logs
    # ---------------------------------------------------------
    if not result.get("success") and "timeout" in result.get("error", "").lower():
        return json.dumps({
            "status": "TIMEOUT",
            "message": "Compilation timed out after 40 seconds. This usually means Unity encountered an issue during domain reload.",
            "action_required": "Use unity_query with query_type='editor_log' to check Unity's console for errors or warnings.",
            "common_causes": [
                "Syntax error preventing compilation",
                "Unity Editor dialog popup blocking (API Updater, etc.)",
                "Script with infinite loop in static constructor",
                "Missing assembly reference"
            ]
        }, indent=2)

    # ---------------------------------------------------------
    # SMART RESPONSE PARSING (your existing logic)
    # ---------------------------------------------------------
    body = result.get("body", {})
    success = result.get("success", False)

    # Case 1: Compilation Failed
    if not success or body.get("compilationErrors"):
        errors = body.get("compilationErrors", [])
        return json.dumps({
            "status": "COMPILATION_FAILED",
            "message": "Unity failed to compile the scripts. You must fix these errors:",
            "errors": errors
        }, indent=2)

    # Case 2: Success
    response = {
        "status": "SUCCESS",
        "message": "Assets refreshed and scripts compiled.",
    }

    # Did we find the scripts the agent cared about?
    if watched_scripts and "watchedScriptsStatus" in body:
        response["verification"] = body["watchedScriptsStatus"]

        # Helper text for the LLM
        missing = [name for name, found in body["watchedScriptsStatus"].items() if not found]
        if missing:
            response["warning"] = f"Compilation passed, but these types are still missing: {missing}. Did you get the class name right inside the file?"
        else:
            response["next_step"] = "You can now use unity_component(action='add') with these scripts."

    return json.dumps(response, indent=2)


# Create the tool using StructuredTool
# Note: This tool is synchronous because interrupt() is synchronous
# The async behavior is handled by the LangGraph runtime
unity_refresh = StructuredTool.from_function(
    func=_unity_refresh,
    name="unity_refresh",
    description="""Trigger Unity Asset Database refresh and Script Compilation. This is "The Compiler".

CRITICAL: You MUST use this tool after creating or editing C# scripts (.cs files).
Unity cannot add a component until the script is compiled.

Behavior:
1. Pauses agent execution while Unity compiles (handled by orchestrator).
2. Returns 'compilationErrors' if syntax errors exist.
3. Confirms if 'watched_scripts' are now valid components.""",
    args_schema=RefreshSchema,
)
