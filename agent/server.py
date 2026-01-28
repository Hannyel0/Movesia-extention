"""
Movesia Agent Server

This server orchestrates:
1. WebSocket server for Unity Editor (Unity connects as client)
2. WebSocket server for VS Code extension chat
3. LangGraph agent execution with streaming
4. Interrupt handling for async Unity operations

Architecture:
┌─────────────────────────────────────────────────────────────┐
│                       server.py                              │
├─────────────────────────────────────────────────────────────┤
│  /ws/chat/{session}  ←── VS Code webview connects here      │
│  /ws/unity           ←── Unity Editor connects here         │
│                                                              │
│  ┌─────────────────┐                                        │
│  │ LangGraph Agent │  Streams tokens, tool calls            │
│  └────────┬────────┘                                        │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────┐      ┌─────────────────┐              │
│  │ Unity Manager   │ ←──► │ Interrupt Mgr   │              │
│  │ (sessions,      │      │ (waits/resumes) │              │
│  │  heartbeat,     │      └─────────────────┘              │
│  │  routing)       │                                        │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import from the improved unity module
from unity import (
    UnityManager,
    Config,
    logger,
    MovesiaMessage,
)
from unity.config import print_startup_banner
from unity.unity_ws import router as unity_router, init_unity_routes

# Manager classes (keeping interrupt and chat managers from managers/)
from managers import InterruptManager, ChatManager

# Chat routes
from routes import chat_router, chat_sse_router
from routes.chat_ws import init_chat_routes

# Agent streaming
from streaming import AgentStreamer

# Your existing agent
from agent import agent


# =============================================================================
# Global Configuration
# =============================================================================

config = Config.from_env()


# =============================================================================
# Global Instances
# =============================================================================

interrupt_manager = InterruptManager()
chat_manager = ChatManager()


async def handle_unity_domain_event(msg: MovesiaMessage) -> None:
    """Handle domain events from Unity (e.g., compilation, hierarchy changes)."""
    logger.info(f"Unity domain event: {msg.type}")

    # Handle compilation finish - resume interrupted operations
    if msg.type == "compile_finished":
        # Interrupt manager handles resumption via unity_manager callback
        pass


# Create Unity manager with the improved implementation
unity_manager = UnityManager(
    interrupt_manager=interrupt_manager,
    on_domain_event=handle_unity_domain_event
)

# The agent is already compiled by create_agent() in agent.py
# We pass it directly to the streamer
# Note: To enable checkpointing, pass checkpointer=MemorySaver() to create_agent() in agent.py
graph = agent

# Create agent streamer
agent_streamer = AgentStreamer(graph, interrupt_manager)


# =============================================================================
# FastAPI Application
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - startup and shutdown."""
    print_startup_banner(config.server.host, config.server.port)
    logger.info("Server ready and listening for connections")
    yield
    logger.info("Shutting down...")
    await interrupt_manager.cancel_all()
    await unity_manager.close_all()
    logger.info("Goodbye! 👋")


app = FastAPI(
    title="Movesia Agent Server",
    description="LangGraph agent server for Unity Editor integration",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.server.cors_origins,
    allow_credentials=config.server.cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize route dependencies
init_unity_routes(unity_manager)
init_chat_routes(chat_manager, unity_manager, agent_streamer.stream_response)

# Include routers
app.include_router(unity_router)
app.include_router(chat_router)
app.include_router(chat_sse_router)  # Vercel AI SDK compatible SSE endpoint


# =============================================================================
# Health Endpoints
# =============================================================================

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "unity_connected": unity_manager.is_connected
    }


@app.get("/status")
async def status():
    """Detailed status endpoint."""
    return {
        "status": "running",
        "unity": {
            "connected": unity_manager.is_connected,
            "project_path": unity_manager.current_project,
            "compiling": unity_manager.is_compiling,
            "connections": unity_manager.connection_count
        },
        "active_chat_sessions": chat_manager.session_count
    }


# =============================================================================
# Unity Command Helper (for use in tools)
# =============================================================================

async def send_unity_command(command_type: str, **kwargs) -> dict:
    """
    Helper function for tools to send commands to Unity.

    Usage in your unity_tools:
        from server import send_unity_command

        async def query_hierarchy():
            return await send_unity_command(
                "query_hierarchy",
                path="/"
            )

    Note: request_id is now auto-generated by the UnityManager.
    """
    return await unity_manager.send_and_wait(command_type, **kwargs)


def get_unity_manager() -> UnityManager:
    """Get the Unity manager instance (for tools that need direct access)."""
    return unity_manager


def get_interrupt_manager() -> InterruptManager:
    """Get the interrupt manager instance (for tools that need to create interrupts)."""
    return interrupt_manager


# =============================================================================
# Main Entry Point
# =============================================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=config.server.host,
        port=config.server.port,
        log_level="warning",  # Reduce Uvicorn noise, our logger handles it
        access_log=False,  # We handle access logging ourselves
    )
