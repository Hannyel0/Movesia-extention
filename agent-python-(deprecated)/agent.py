import os
from pathlib import Path
from typing import Literal, Optional
from dotenv import load_dotenv
from tavily import TavilyClient
from langchain.agents import create_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend, FilesystemBackend
from deepagents.middleware.filesystem import FilesystemMiddleware
# from langchain.agents.middleware import TodoListMiddleware
from middlewares.optimizedTodoMiddleware import OptimizedTodoMiddleware
from langchain_openai import ChatOpenAI
from unity_tools import unity_tools
from prompts import UNITY_AGENT_PROMPT

load_dotenv()

# Unity project path - set in .env file
UNITY_PROJECT_PATH = os.getenv("UNITY_PROJECT_PATH")
if not UNITY_PROJECT_PATH:
    raise ValueError("UNITY_PROJECT_PATH environment variable must be set")

# Pre-resolve the path at module load time (synchronous context is fine here)
UNITY_PROJECT_PATH_RESOLVED = str(Path(UNITY_PROJECT_PATH).resolve())

# Pre-create FilesystemBackend at module level (blocking is OK here)
_unity_fs_backend = FilesystemBackend(
    root_dir=UNITY_PROJECT_PATH_RESOLVED,
    virtual_mode=True
)

tavily_client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])

def internet_search(
    query: str,
    max_results: int = 5,
    topic: Literal["general", "news"] = "general"
):
    """Search the web."""
    return tavily_client.search(query, max_results=max_results, topic=topic)

model = ChatOpenAI(
    model="anthropic/claude-haiku-4.5",
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)


def make_composite_backend(runtime):
    """
    Routes:
    - /memories/  → StoreBackend (persistent across all threads)
    - /scratch/   → StateBackend (ephemeral, current thread only)
    - everything else → FilesystemBackend (Unity project on disk)
    """
    return CompositeBackend(
        default=_unity_fs_backend,  # Use pre-created instance
        routes={
            "/memories/": StoreBackend(runtime),
            "/scratch/": StateBackend(runtime),
        }
    )


# Checkpointer will be injected by server.py after database initialization
# This allows us to use AsyncSqliteSaver for persistent checkpoints
_checkpointer = None


def create_movesia_agent(checkpointer=None):
    """
    Create the Movesia agent with the given checkpointer.

    Args:
        checkpointer: LangGraph checkpointer (AsyncSqliteSaver or MemorySaver)

    Returns:
        Compiled LangGraph agent
    """
    return create_agent(
        model=model,
        tools=[internet_search, *unity_tools],
        system_prompt=UNITY_AGENT_PROMPT,
        middleware=[
            # TodoListMiddleware(),  # Original - ~1,400 tokens
            OptimizedTodoMiddleware(),  # Optimized - ~520 tokens (balanced mode)
            FilesystemMiddleware(backend=make_composite_backend),
        ],
        checkpointer=checkpointer,
    )


# For backwards compatibility, create a default agent with MemorySaver
# This will be replaced by server.py with the database-backed checkpointer
from langgraph.checkpoint.memory import MemorySaver
agent = create_movesia_agent(checkpointer=MemorySaver())
