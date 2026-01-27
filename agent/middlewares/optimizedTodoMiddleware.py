"""
OPTIMIZED TODO LIST MIDDLEWARE (Balanced Version)
==================================================

Drop-in replacement for LangChain's TodoListMiddleware with ~50-55% fewer tokens.
Preserves essential examples and guidance while removing redundancy.
Includes STRONGER emphasis on status updates to ensure tasks get marked completed.

ORIGINAL vs OPTIMIZED:
┌─────────────────────────┬──────────────┬─────────────┬─────────┐
│ Component               │ Original     │ Optimized   │ Savings │
├─────────────────────────┼──────────────┼─────────────┼─────────┤
│ Tool description        │ ~1,200 tokens│ ~550 tokens │ 54%     │
│ System prompt           │ ~150 tokens  │ ~80 tokens  │ 47%     │
│ Tool response (per use) │ ~30 tokens   │ ~2 tokens   │ 93%     │
│ State overhead          │ ~15 tokens   │ ~8 tokens   │ 47%     │
├─────────────────────────┼──────────────┼─────────────┼─────────┤
│ TOTAL (first call)      │ ~1,400       │ ~640        │ 54%     │
│ TOTAL (10 calls)        │ ~1,700       │ ~670        │ 61%     │
└─────────────────────────┴──────────────┴─────────────┴─────────┘

KEY OPTIMIZATIONS (while preserving functionality):
1. Compressed tool description - removed verbose reasoning blocks, kept examples
2. Condensed system prompt - essential rules with IMPORTANT callouts
3. Tiny tool response ("ok" vs JSON echo)
4. Auto-cleanup of old write_todos calls from message history
5. Conditional prompt injection (skip if todos exist)
6. Added example workflow showing status transitions
7. Stronger emphasis on marking tasks completed IMMEDIATELY

WHAT WE KEPT:
- Clear when-to-use and when-NOT-to-use guidance
- Representative examples for both cases
- Status management rules with CRITICAL/IMPORTANT callouts
- Example workflow showing the status update pattern
- Task completion requirements
"""

from __future__ import annotations

from typing import Any, Callable, Literal
from typing_extensions import NotRequired, TypedDict

from langchain_core.tools import tool, BaseTool
from langchain_core.messages import AIMessage, ToolMessage, SystemMessage
from langgraph.types import Command

try:
    from langchain.agents.middleware import (
        AgentMiddleware,
        AgentState,
        ModelRequest,
    )
except ImportError:
    from langchain.agents import AgentMiddleware, AgentState
    ModelRequest = Any


__all__ = [
    "OptimizedTodoMiddleware",
    "LeanTodoMiddleware",
    "UltraTodoMiddleware",
    "MicroTodoMiddleware",
    "TodoState",
    "CompactTodoState",
    "Todo",
    "CompactTodo",
    "format_todos",
    "get_todo_stats",
]


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL DESCRIPTIONS - Balanced versions with examples
# ═══════════════════════════════════════════════════════════════════════════════

# BALANCED: ~550 tokens - Keeps essential examples, stronger status update emphasis
BALANCED_TOOL_DESCRIPTION = """Manage a structured task list for complex work sessions. Helps track progress and shows the user your plan.

## When to Use
- Complex multi-step tasks (3+ distinct steps)
- Tasks requiring planning or multiple operations  
- User explicitly requests a todo list
- User provides multiple tasks to complete
- Plan may need revision based on intermediate results

## When NOT to Use
- Single straightforward task
- Trivial tasks (<3 simple steps)
- Purely conversational/informational requests
- A few simple parallel tool calls

## Examples - USE the todo list:

User: "Add dark mode toggle to settings. Run tests and build when done."
→ Use todos: Multi-step feature (UI + state + styling + tests)

User: "Help me plan a marketing campaign: social media, email, and press releases"
→ Use todos: Multiple distinct channels requiring coordination

User: "Rename getCwd to getCurrentWorkingDirectory across my project"
→ Use todos (after searching): Found 15 instances across 8 files - track systematically

## Examples - DON'T use the todo list:

User: "How do I print Hello World in Python?"
→ Skip todos: Single trivial answer

User: "Add a comment to the calculateTotal function"
→ Skip todos: Single simple edit

User: "Write a function to check if a number is prime and test it"
→ Skip todos: Only 2 trivial steps

User: "Order pizza from Dominos, burger from McDonalds, salad from Subway"
→ Skip todos: 3 simple parallel calls, no planning needed

## Status Values
- **pending**: Not started yet
- **in_progress**: Currently working on this task
- **completed**: Task finished successfully

## CRITICAL Status Update Rules

**IMPORTANT:** You MUST update task status in real-time as you work!

1. **When creating the list:** Mark your first task as `in_progress` immediately
2. **Before starting any task:** Mark it as `in_progress` first
3. **After completing any task:** Mark it as `completed` IMMEDIATELY - do NOT batch completions
4. **While working:** Always have at least one task marked `in_progress` (unless all are done)
5. **After finishing a task:** Mark it `completed`, then mark the next task `in_progress`

## Example Workflow
```
1. Create todos → Task 1: in_progress, Tasks 2-3: pending
2. Finish task 1 → Task 1: completed, Task 2: in_progress, Task 3: pending  
3. Finish task 2 → Tasks 1-2: completed, Task 3: in_progress
4. Finish task 3 → All tasks: completed
```

Do NOT wait until the end to mark tasks completed. Update status after EACH task."""


# LEAN: ~320 tokens - Condensed examples with status emphasis
LEAN_TOOL_DESCRIPTION = """Manage task list for complex work. Use for 3+ step tasks to track progress and show the user your plan.

## When to Use
- Multi-step tasks (3+ steps), complex planning, user requests tracking
- Example: "Add dark mode + run tests" → Use todos (UI + state + styling + tests)
- Example: "Plan marketing campaign" → Use todos (multiple channels)

## When NOT to Use  
- Simple queries, single actions, <3 trivial steps
- Example: "Print Hello World" → Skip (trivial)
- Example: "Write prime checker and test it" → Skip (only 2 steps)
- Example: "Order from 3 restaurants" → Skip (3 simple parallel calls)

## Status: pending → in_progress → completed

**IMPORTANT - Update status in real-time:**
1. When creating list: Mark first task `in_progress` immediately
2. After completing a task: Mark it `completed` RIGHT AWAY, then mark next task `in_progress`
3. Always keep 1+ task `in_progress` while working
4. Do NOT wait until the end - update after EACH task completion

Example: Create (T1:in_progress, T2:pending) → Finish T1 (T1:completed, T2:in_progress) → Finish T2 (all completed)"""


# ULTRA: ~150 tokens - Minimal but with status emphasis
ULTRA_TOOL_DESCRIPTION = """Task list for complex (3+ step) work. Shows user your plan and progress.

Use for: Multi-step features, complex planning, multiple coordinated tasks.
Skip for: Simple questions, single edits, <3 trivial steps, simple parallel calls.

Status: pending (not started) → in_progress (working) → completed (done)

IMPORTANT Rules:
- Mark first task `in_progress` when creating list
- Mark `completed` IMMEDIATELY after finishing each task
- Then mark next task `in_progress`
- Keep 1+ task `in_progress` while working
- Do NOT batch - update after EACH task"""


# ═══════════════════════════════════════════════════════════════════════════════
# SYSTEM PROMPTS
# ═══════════════════════════════════════════════════════════════════════════════

# BALANCED: ~80 tokens
BALANCED_SYSTEM_PROMPT = """## write_todos
Use for complex 3+ step tasks to plan and track progress. Skip for simple requests.

CRITICAL: Update task status in real-time!
- Mark `in_progress` BEFORE starting each task
- Mark `completed` IMMEDIATELY after finishing each task - don't batch!
- Always have 1+ task `in_progress` while working

Never call write_todos multiple times in parallel. Revise the list as needed."""

# LEAN: ~50 tokens  
LEAN_SYSTEM_PROMPT = """write_todos: Use for 3+ step complex tasks. Skip for simple requests.
IMPORTANT: Mark tasks `completed` IMMEDIATELY after finishing each one - don't wait! Always keep 1+ task `in_progress` while working."""

# ULTRA: ~30 tokens
ULTRA_SYSTEM_PROMPT = """write_todos: 3+ step tasks only. IMPORTANT: Mark completed IMMEDIATELY after each task. Keep 1+ in_progress while working."""


# ═══════════════════════════════════════════════════════════════════════════════
# STATE SCHEMAS
# ═══════════════════════════════════════════════════════════════════════════════

class Todo(TypedDict):
    """Standard todo item - compatible with original TodoListMiddleware."""
    content: str
    status: Literal["pending", "in_progress", "completed"]


class TodoState(AgentState):
    """Standard state schema - compatible with original."""
    todos: NotRequired[list[Todo]]


class CompactTodo(TypedDict):
    """Compact todo item - fewer tokens in state serialization."""
    t: str
    s: Literal["p", "w", "d"]


class CompactTodoState(AgentState):
    """Compact state schema."""
    todos: NotRequired[list[CompactTodo]]


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL FACTORIES
# ═══════════════════════════════════════════════════════════════════════════════

def _create_standard_tool(description: str) -> BaseTool:
    """Create write_todos tool with standard schema."""
    
    @tool
    def write_todos(todos: list[dict[str, str]]) -> str:
        """Manage todo list. Each item: {content: "task", status: "pending|in_progress|completed"}"""
        return "ok"
    
    write_todos.description = description
    return write_todos


def _create_compact_tool(description: str) -> BaseTool:
    """Create write_todos tool with compact schema."""
    
    @tool
    def write_todos(todos: list[dict[str, str]]) -> str:
        """Manage todo list. Items: {t: "task", s: "p|w|d"} where p=pending, w=in_progress, d=done"""
        return "ok"
    
    write_todos.description = description
    return write_todos


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN MIDDLEWARE
# ═══════════════════════════════════════════════════════════════════════════════

class OptimizedTodoMiddleware(AgentMiddleware):
    """
    Optimized replacement for TodoListMiddleware.
    
    Reduces tokens by ~50-55% while preserving essential guidance and examples.
    Includes stronger emphasis on status updates to ensure tasks get marked completed.
    
    Modes:
    - "balanced" (~640 tokens): Full examples, best for reliability
    - "lean" (~370 tokens): Condensed examples, good balance  
    - "ultra" (~180 tokens): Minimal, for capable models
    - "none" (~40 tokens): Tool schema only
    
    Example:
        ```python
        from langchain.agents import create_agent
        from optimized_todo_middleware import OptimizedTodoMiddleware
        
        agent = create_agent(
            model="claude-sonnet-4-5-20250929",
            middleware=[OptimizedTodoMiddleware()],  # Uses "balanced" by default
        )
        ```
    """
    
    DESCRIPTIONS = {
        "balanced": BALANCED_TOOL_DESCRIPTION,
        "lean": LEAN_TOOL_DESCRIPTION,
        "ultra": ULTRA_TOOL_DESCRIPTION,
        "none": "Manage todo list for multi-step tasks.",
    }
    
    PROMPTS = {
        "balanced": BALANCED_SYSTEM_PROMPT,
        "lean": LEAN_SYSTEM_PROMPT,
        "ultra": ULTRA_SYSTEM_PROMPT,
        "none": "",
    }
    
    def __init__(
        self,
        *,
        tool_description: str | None = None,
        system_prompt: str | None = None,
        mode: Literal["balanced", "lean", "ultra", "none"] = "balanced",
        auto_cleanup: bool = True,
        keep_last: int = 1,
        conditional_prompt: bool = True,
        compact_state: bool = False,
    ):
        """
        Initialize optimized todo middleware.
        
        Args:
            tool_description: Custom tool description (overrides mode)
            system_prompt: Custom system prompt (overrides mode)
            mode: Verbosity level
                - "balanced" (~640 tokens): Full examples, recommended
                - "lean" (~370 tokens): Condensed, good balance
                - "ultra" (~180 tokens): Minimal guidance
                - "none" (~40 tokens): Tool schema only
            auto_cleanup: Remove old write_todos calls from message history
            keep_last: Number of recent write_todos calls to keep
            conditional_prompt: Skip prompt injection if todos already exist
            compact_state: Use compact state format (t/s vs content/status)
        """
        super().__init__()
        
        self._tool_desc = tool_description or self.DESCRIPTIONS.get(mode, self.DESCRIPTIONS["balanced"])
        self._sys_prompt = system_prompt if system_prompt is not None else self.PROMPTS.get(mode, "")
        
        self._auto_cleanup = auto_cleanup
        self._keep_last = max(0, keep_last)
        self._conditional = conditional_prompt
        self._compact = compact_state
        
        if compact_state:
            self._tool = _create_compact_tool(self._tool_desc)
        else:
            self._tool = _create_standard_tool(self._tool_desc)
    
    @property
    def state_schema(self):
        return CompactTodoState if self._compact else TodoState
    
    @property
    def tools(self) -> list[BaseTool]:
        return [self._tool]
    
    # ─────────────────────────────────────────────────────────────────────────
    # Model request modification
    # ─────────────────────────────────────────────────────────────────────────
    
    def modify_model_request(self, request: ModelRequest) -> ModelRequest:
        """Apply optimizations to model request."""
        
        # 1. Clean old write_todos calls
        if self._auto_cleanup:
            messages = self._prune_todo_history(list(request.messages))
            request = request.override(messages=messages)
        
        # 2. Conditional system prompt injection
        if self._sys_prompt:
            should_inject = True
            if self._conditional and request.state.get("todos"):
                should_inject = False
            
            if should_inject:
                blocks = list(request.system_message.content_blocks)
                blocks.append({"type": "text", "text": f"\n\n{self._sys_prompt}"})
                request = request.override(
                    system_message=SystemMessage(content=blocks)
                )
        
        return request
    
    def _prune_todo_history(self, messages: list) -> list:
        """Remove old write_todos tool calls from history."""
        
        todo_pairs: list[tuple[int, int]] = []
        
        for i, msg in enumerate(messages):
            if not isinstance(msg, AIMessage):
                continue
            if not hasattr(msg, "tool_calls") or not msg.tool_calls:
                continue
            
            for tc in msg.tool_calls:
                if tc.get("name") != "write_todos":
                    continue
                
                tc_id = tc.get("id")
                for j in range(i + 1, len(messages)):
                    if isinstance(messages[j], ToolMessage):
                        if getattr(messages[j], "tool_call_id", None) == tc_id:
                            todo_pairs.append((i, j))
                            break
                break
        
        if len(todo_pairs) <= self._keep_last:
            return messages
        
        remove = set()
        for ai_idx, tool_idx in todo_pairs[:-self._keep_last]:
            remove.add(ai_idx)
            remove.add(tool_idx)
        
        return [m for i, m in enumerate(messages) if i not in remove]
    
    # ─────────────────────────────────────────────────────────────────────────
    # Tool call handling
    # ─────────────────────────────────────────────────────────────────────────
    
    def wrap_tool_call(self, request, handler: Callable) -> ToolMessage | Command:
        if request.tool_call.get("name") == "write_todos":
            return self._handle_write_todos(request)
        return handler(request)
    
    async def awrap_tool_call(self, request, handler: Callable) -> ToolMessage | Command:
        if request.tool_call.get("name") == "write_todos":
            return self._handle_write_todos(request)
        return await handler(request)
    
    def _handle_write_todos(self, request) -> Command:
        """Process write_todos call and update state."""
        
        raw_todos = request.tool_call.get("args", {}).get("todos", [])
        todos = []
        
        for item in raw_todos:
            if not isinstance(item, dict):
                continue
            
            if self._compact:
                text = item.get("t") or item.get("content", "")
                status = item.get("s") or item.get("status", "p")
                if status in ("pending", "p"):
                    status = "p"
                elif status in ("in_progress", "w", "working"):
                    status = "w"
                elif status in ("completed", "d", "done"):
                    status = "d"
                else:
                    status = "p"
                if text:
                    todos.append({"t": str(text)[:500], "s": status})
            else:
                text = item.get("content") or item.get("t", "")
                status = item.get("status") or item.get("s", "pending")
                if status in ("p", "pending"):
                    status = "pending"
                elif status in ("w", "working", "in_progress"):
                    status = "in_progress"
                elif status in ("d", "done", "completed"):
                    status = "completed"
                else:
                    status = "pending"
                if text:
                    todos.append({"content": str(text)[:500], "status": status})
        
        return Command(
            update={
                "todos": todos,
                "messages": [
                    ToolMessage(
                        content="ok",
                        tool_call_id=request.tool_call["id"],
                    )
                ],
            }
        )


# ═══════════════════════════════════════════════════════════════════════════════
# PRESET CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

class LeanTodoMiddleware(OptimizedTodoMiddleware):
    """
    Lean preset - condensed examples, ~370 tokens.
    Good balance of guidance and efficiency.
    """
    def __init__(self, **kwargs):
        kwargs.setdefault("mode", "lean")
        super().__init__(**kwargs)


class UltraTodoMiddleware(OptimizedTodoMiddleware):
    """
    Ultra preset - minimal guidance, ~180 tokens.
    Best for capable models that need less hand-holding.
    """
    def __init__(self, **kwargs):
        kwargs.setdefault("mode", "ultra")
        super().__init__(**kwargs)


class MicroTodoMiddleware(AgentMiddleware):
    """
    Absolute minimum - tool schema only, ~40 tokens.
    Use when your system prompt already has todo instructions.
    """
    
    state_schema = TodoState
    
    def __init__(self, compact: bool = False):
        super().__init__()
        self._compact = compact
        desc = "Todo list. {t:'task', s:'p|w|d'}" if compact else "Todo list management."
        self._tool = _create_compact_tool(desc) if compact else _create_standard_tool(desc)
    
    @property
    def tools(self) -> list[BaseTool]:
        return [self._tool]
    
    def wrap_tool_call(self, request, handler: Callable) -> ToolMessage | Command:
        if request.tool_call.get("name") == "write_todos":
            todos = []
            for item in request.tool_call.get("args", {}).get("todos", []):
                if isinstance(item, dict):
                    if self._compact:
                        t = item.get("t") or item.get("content", "")
                        s = item.get("s", "p")
                        if s in ("pending", "p"): s = "p"
                        elif s in ("in_progress", "w"): s = "w"
                        elif s in ("completed", "d"): s = "d"
                        if t: todos.append({"t": t, "s": s})
                    else:
                        c = item.get("content") or item.get("t", "")
                        st = item.get("status", "pending")
                        if st == "p": st = "pending"
                        elif st == "w": st = "in_progress"
                        elif st == "d": st = "completed"
                        if c: todos.append({"content": c, "status": st})
            
            return Command(
                update={
                    "todos": todos,
                    "messages": [ToolMessage(content="ok", tool_call_id=request.tool_call["id"])],
                }
            )
        return handler(request)
    
    async def awrap_tool_call(self, request, handler: Callable) -> ToolMessage | Command:
        return self.wrap_tool_call(request, handler)


# ═══════════════════════════════════════════════════════════════════════════════
# UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

def format_todos(
    todos: list[Todo] | list[CompactTodo] | None,
    style: Literal["emoji", "text", "markdown", "compact"] = "emoji",
) -> str:
    """Format todos for display."""
    if not todos:
        return "(no todos)"
    
    is_compact = todos and "t" in todos[0]
    lines = []
    
    for item in todos:
        if is_compact:
            text = item.get("t", "")
            status = item.get("s", "p")
        else:
            text = item.get("content", "")
            status = item.get("status", "pending")
            if status == "pending": status = "p"
            elif status == "in_progress": status = "w"
            elif status == "completed": status = "d"
        
        if style == "emoji":
            icons = {"p": "⏳", "w": "🔄", "d": "✅"}
            lines.append(f"{icons.get(status, '?')} {text}")
        elif style == "text":
            labels = {"p": "PENDING", "w": "IN PROGRESS", "d": "COMPLETED"}
            lines.append(f"[{labels.get(status, '?')}] {text}")
        elif style == "markdown":
            checks = {"p": "[ ]", "w": "[~]", "d": "[x]"}
            lines.append(f"- {checks.get(status, '[ ]')} {text}")
        elif style == "compact":
            lines.append(f"{status}:{text}")
    
    return "\n".join(lines) if style != "compact" else " | ".join(lines)


def get_todo_stats(todos: list | None) -> dict[str, int]:
    """Get completion statistics."""
    if not todos:
        return {"total": 0, "pending": 0, "in_progress": 0, "completed": 0, "progress": 0}
    
    counts = {"pending": 0, "in_progress": 0, "completed": 0}
    
    for item in todos:
        if "s" in item:
            s = item["s"]
            if s == "p": counts["pending"] += 1
            elif s == "w": counts["in_progress"] += 1
            elif s == "d": counts["completed"] += 1
        else:
            counts[item.get("status", "pending")] += 1
    
    total = len(todos)
    done = counts["completed"]
    
    return {
        "total": total,
        **counts,
        "progress": int((done / total) * 100) if total > 0 else 0,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# DOCUMENTATION
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("""
╔══════════════════════════════════════════════════════════════════════════════╗
║              OPTIMIZED TODO LIST MIDDLEWARE (Balanced)                       ║
║                                                                              ║
║        Drop-in replacement with ~50-55% fewer tokens                         ║
║        Preserves examples + STRONGER status update emphasis                  ║
╚══════════════════════════════════════════════════════════════════════════════╝

MODE COMPARISON:
────────────────────────────────────────────────────────────────────────────────
┌──────────────┬─────────────┬─────────────┬──────────────────────────────────┐
│ Mode         │ Tokens      │ Savings     │ Best For                         │
├──────────────┼─────────────┼─────────────┼──────────────────────────────────┤
│ Original     │ ~1,400      │ -           │ (baseline)                       │
│ balanced     │ ~640        │ 54%         │ Most reliable, full examples     │
│ lean         │ ~370        │ 74%         │ Good balance                     │
│ ultra        │ ~180        │ 87%         │ Capable models                   │
│ none/micro   │ ~40         │ 97%         │ Custom system prompt             │
└──────────────┴─────────────┴─────────────┴──────────────────────────────────┘

QUICK START:
────────────────────────────────────────────────────────────────────────────────

    from langchain.agents import create_agent
    from optimized_todo_middleware import OptimizedTodoMiddleware
    
    # Recommended - balanced mode (default)
    agent = create_agent(
        model="claude-sonnet-4-5-20250929",
        middleware=[OptimizedTodoMiddleware()],
    )
    
    # Leaner options
    agent = create_agent(
        model="claude-sonnet-4-5-20250929",
        middleware=[OptimizedTodoMiddleware(mode="lean")],   # ~290 tokens
    )
    
    # Or use preset classes
    from optimized_todo_middleware import LeanTodoMiddleware, UltraTodoMiddleware
    
    agent = create_agent(
        model="claude-sonnet-4-5-20250929", 
        middleware=[LeanTodoMiddleware()],
    )

WHAT'S PRESERVED:
────────────────────────────────────────────────────────────────────────────────

✅ When-to-use examples:
   - "Add dark mode + run tests" → Use todos
   - "Plan marketing campaign" → Use todos
   - "Rename function across project" → Use todos

✅ When-NOT-to-use examples:
   - "Print Hello World" → Skip
   - "Write prime checker and test" → Skip (only 2 steps)
   - "Order from 3 restaurants" → Skip (simple parallel calls)

✅ Status management rules (STRONGER emphasis):
   - Mark `in_progress` BEFORE starting each task
   - Mark `completed` IMMEDIATELY after finishing - don't batch!
   - Keep 1+ task `in_progress` while working
   - Example workflow showing status transitions

✅ IMPORTANT/CRITICAL callouts to reinforce behavior

WHAT'S OPTIMIZED:
────────────────────────────────────────────────────────────────────────────────

🔧 Removed verbose <reasoning> blocks from examples
🔧 Condensed duplicate explanations  
🔧 Tool response: "ok" instead of JSON echo (~30 → 2 tokens per call)
🔧 Auto-cleanup of old write_todos from message history
🔧 Conditional prompt (skip if todos already exist)

WHAT'S ADDED:
────────────────────────────────────────────────────────────────────────────────

✨ CRITICAL/IMPORTANT callouts for status updates
✨ Example workflow showing status transitions step-by-step
✨ Clearer "mark completed IMMEDIATELY" emphasis
""")