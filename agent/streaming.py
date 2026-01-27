"""
Agent Execution with Streaming.

Handles running the LangGraph agent and streaming responses to clients.
Also manages interrupts by waiting for Unity and resuming.
"""

from typing import Optional
import logging

from fastapi import WebSocket
from langgraph.types import Command

from utils import safe_serialize, truncate_output

logger = logging.getLogger("movesia.streaming")


class AgentStreamer:
    """Handles agent execution and streaming to WebSocket clients."""

    def __init__(self, graph, interrupt_manager):
        self._graph = graph
        self._interrupt_manager = interrupt_manager

    async def stream_response(self, websocket: WebSocket, user_message: str, config: dict):
        """
        Run the agent and stream responses to the client.
        Handles interrupts by waiting for Unity and resuming.
        """
        input_data = {"messages": [("human", user_message)]}

        logger.info("Agent processing started")

        # Notify client we're starting
        await websocket.send_json({
            "type": "start",
            "message": "Processing..."
        })

        while True:
            try:
                # Stream agent execution
                async for event in self._graph.astream_events(input_data, config=config, version="v2"):
                    await self._handle_stream_event(websocket, event)

                # Check if we hit an interrupt
                state = await self._graph.aget_state(config)

                if state.next:  # There's pending work (interrupt)
                    interrupt_result = await self._handle_interrupt(websocket, state, config)

                    if interrupt_result is not None:
                        # Resume with the interrupt result
                        input_data = Command(resume=interrupt_result)
                        continue

                # No interrupt, we're done
                break

            except Exception as e:
                logger.error(f"Agent execution error: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": f"Agent error: {str(e)}"
                })
                break

        # Signal completion
        await websocket.send_json({"type": "complete"})
        logger.info("Agent processing complete")

    async def _handle_stream_event(self, websocket: WebSocket, event: dict):
        """Handle individual stream events from the agent."""
        kind = event.get("event")

        if kind == "on_chat_model_start":
            await websocket.send_json({
                "type": "thinking",
                "message": "Thinking..."
            })

        elif kind == "on_chat_model_stream":
            # Streaming token from LLM
            chunk = event.get("data", {}).get("chunk")
            if chunk and hasattr(chunk, "content") and chunk.content:
                await websocket.send_json({
                    "type": "token",
                    "content": chunk.content
                })

        elif kind == "on_chat_model_end":
            # LLM finished generating
            pass

        elif kind == "on_tool_start":
            # Tool is starting
            tool_name = event.get("name", "unknown")
            tool_input = event.get("data", {}).get("input", {})

            await websocket.send_json({
                "type": "tool_start",
                "name": tool_name,
                "input": safe_serialize(tool_input)
            })

            logger.info(f"🔧 Tool: {tool_name}")

        elif kind == "on_tool_end":
            # Tool finished
            tool_name = event.get("name", "unknown")
            tool_output = event.get("data", {}).get("output")

            await websocket.send_json({
                "type": "tool_end",
                "name": tool_name,
                "output": truncate_output(tool_output)
            })

            logger.info(f"✓ Tool done: {tool_name}")

        elif kind == "on_tool_error":
            # Tool errored
            tool_name = event.get("name", "unknown")
            error = event.get("data", {}).get("error", "Unknown error")

            await websocket.send_json({
                "type": "tool_error",
                "name": tool_name,
                "error": str(error)
            })

            logger.error(f"✗ Tool failed: {tool_name} - {error}")

    async def _handle_interrupt(self, websocket: WebSocket, state, config: dict) -> Optional[dict]:
        """
        Handle an agent interrupt (e.g., waiting for Unity compilation).
        Returns the result to resume with, or None if no interrupt to handle.
        """
        # Extract interrupt data
        interrupt_data = None
        if hasattr(state, 'values') and '__interrupt__' in state.values:
            interrupts = state.values.get('__interrupt__', [])
            if interrupts:
                interrupt_data = interrupts[0].get('value', {}) if isinstance(interrupts[0], dict) else {}

        if not interrupt_data:
            return None

        interrupt_type = interrupt_data.get("type", "unknown")
        request_id = interrupt_data.get("request_id")

        logger.info(f"⏸ Interrupt: {interrupt_type}")

        # Notify client we're waiting
        await websocket.send_json({
            "type": "waiting",
            "interrupt_type": interrupt_type,
            "message": interrupt_data.get("message", f"Waiting for {interrupt_type}...")
        })

        if not request_id:
            logger.error("Interrupt missing request_id")
            return {"success": False, "error": "Missing request_id in interrupt"}

        # Wait for Unity to resolve this interrupt
        result = await self._interrupt_manager.wait(request_id)

        # Notify client interrupt resolved
        await websocket.send_json({
            "type": "interrupt_resolved",
            "interrupt_type": interrupt_type,
            "success": result.get("success", False)
        })

        return result
