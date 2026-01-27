import os
from pathlib import Path
from typing import Literal
from dotenv import load_dotenv
from tavily import TavilyClient
from langchain.agents import create_agent
from langgraph.checkpoint.memory import MemorySaver
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
    model="x-ai/grok-code-fast-1",
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


# Memory checkpointer for conversation persistence across messages
memory = MemorySaver()

agent = create_agent(
    model=model,
    tools=[internet_search, *unity_tools],
    system_prompt=UNITY_AGENT_PROMPT,
    middleware=[
        # TodoListMiddleware(),  # Original - ~1,400 tokens
        OptimizedTodoMiddleware(),  # Optimized - ~520 tokens (balanced mode)
        FilesystemMiddleware(backend=make_composite_backend),
    ],
    checkpointer=memory,  # Enable conversation memory
)
