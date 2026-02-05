# routes/chat_sse.py
"""
SSE endpoint that speaks Vercel AI SDK UI Message Stream Protocol v1.
This runs alongside the existing WebSocket endpoint.

Protocol spec: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
"""

import json
import uuid
import logging
import traceback
from datetime import datetime
from typing import AsyncGenerator, Any
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from utils import safe_serialize, truncate_output
from database.repository import get_repository

router = APIRouter()

# Will be set by init_chat_sse_routes()
_graph = None


def init_chat_sse_routes(graph):
    """Initialize the SSE routes with the correct agent graph."""
    global _graph
    _graph = graph

# Setup logger for chat SSE
logger = logging.getLogger("movesia.chat")

# =============================================================================
# Debug helper for tool call rendering issues
# =============================================================================
def log_sse_event(event_type: str, data: dict, extra_info: str = ""):
    """Log SSE events being sent to frontend for debugging tool rendering."""
    compact = json.dumps(data, default=str)[:300]
    logger.info(f"[SSE→UI] {event_type}: {compact} {extra_info}")


class UIMessageStreamProtocol:
    """
    Implements Vercel AI SDK UI Message Stream Protocol v1.
    Uses SSE format with JSON messages.

    Message types:
    - start: Begin a new message
    - text-start/text-delta/text-end: Stream text content
    - tool-input-start/tool-input-delta/tool-input-available: Tool calls
    - tool-output-available: Tool results
    - finish-step/finish: Complete the stream
    - error: Report errors
    """

    def __init__(self):
        self.message_id = f"msg_{uuid.uuid4().hex}"
        self.text_id = f"text_{uuid.uuid4().hex}"
        self.text_started = False

    def _sse(self, data: dict) -> str:
        """Format as SSE data line."""
        result = f"data: {json.dumps(data)}\n\n"
        return result

    def start(self) -> str:
        """Start a new assistant message."""
        return self._sse({"type": "start", "messageId": self.message_id})

    def text_start(self) -> str:
        """Start text content block."""
        self.text_started = True
        return self._sse({"type": "text-start", "id": self.text_id})

    def text_delta(self, content: str) -> str:
        """Stream text delta."""
        if not content:
            return ""
        return self._sse({"type": "text-delta", "id": self.text_id, "delta": content})

    def text_end(self) -> str:
        """End text content block."""
        if not self.text_started:
            return ""
        self.text_started = False
        return self._sse({"type": "text-end", "id": self.text_id})

    def tool_input_start(self, tool_call_id: str, tool_name: str) -> str:
        """Start tool input streaming."""
        data = {
            "type": "tool-input-start",
            "toolCallId": tool_call_id,
            "toolName": tool_name
        }
        log_sse_event("TOOL_INPUT_START", data)
        return self._sse(data)

    def tool_input_delta(self, tool_call_id: str, delta: str) -> str:
        """Stream tool input delta."""
        return self._sse({
            "type": "tool-input-delta",
            "toolCallId": tool_call_id,
            "inputTextDelta": delta
        })

    def tool_input_available(self, tool_call_id: str, tool_name: str, input_data: Any) -> str:
        """Tool input is fully available."""
        data = {
            "type": "tool-input-available",
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "input": input_data
        }
        log_sse_event("TOOL_INPUT_AVAILABLE", data)
        return self._sse(data)

    def tool_output_available(self, tool_call_id: str, output: Any) -> str:
        """Tool output is available."""
        data = {
            "type": "tool-output-available",
            "toolCallId": tool_call_id,
            "output": output
        }
        log_sse_event("TOOL_OUTPUT_AVAILABLE", data)
        return self._sse(data)

    def finish_step(self) -> str:
        """Finish a step (after tool calls, before continuing)."""
        data = {"type": "finish-step"}
        log_sse_event("FINISH_STEP", data, "(tool execution complete)")
        return self._sse(data)

    def finish(self) -> str:
        """Finish the message."""
        return self._sse({"type": "finish"})

    def error(self, message: str) -> str:
        """Report an error."""
        logger.error(f"[SSE] Error: {message}")
        return self._sse({"type": "error", "errorText": message})

    def done(self) -> str:
        """Signal end of stream."""
        return "data: [DONE]\n\n"


async def stream_agent_sse(
    user_message: str,
    thread_id: str,
    protocol: UIMessageStreamProtocol,
    is_first_message: bool = False
) -> AsyncGenerator[str, None]:
    """Stream agent execution using AI SDK UI Message Stream Protocol."""
    if _graph is None:
        raise RuntimeError("SSE routes not initialized. Call init_chat_sse_routes() first.")

    config = {"configurable": {"thread_id": thread_id}}
    input_data = {"messages": [("human", user_message)]}

    # Save conversation metadata
    repo = get_repository()
    conversation = await repo.get_or_create(session_id=thread_id)

    # Set title from first message
    if conversation.title is None:
        title = user_message[:100].strip()
        if len(user_message) > 100:
            title += "..."
        await repo.update_title(thread_id, title)
    else:
        await repo.touch(thread_id)

    # Track state
    has_text_content = False
    current_tool_calls = {}  # track tool_call_id -> tool_name
    tool_call_count = 0
    start_time = datetime.now()

    logger.info(f"[Stream] Starting for thread={thread_id[:16]}...")

    try:
        # Start the message
        yield protocol.start()

        async for event in _graph.astream_events(input_data, config=config, version="v2"):
            kind = event.get("event")

            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content"):
                    content = chunk.content
                    # Handle both string and list content
                    if isinstance(content, str) and content:
                        # Start text block if not already started
                        if not has_text_content:
                            yield protocol.text_start()
                            has_text_content = True
                        yield protocol.text_delta(content)
                    elif isinstance(content, list):
                        for block in content:
                            text = ""
                            if isinstance(block, dict) and block.get("type") == "text":
                                text = block.get("text", "")
                            elif isinstance(block, str):
                                text = block

                            if text:
                                if not has_text_content:
                                    yield protocol.text_start()
                                    has_text_content = True
                                yield protocol.text_delta(text)

            elif kind == "on_tool_start":
                # End any ongoing text block before tool call
                if has_text_content:
                    yield protocol.text_end()
                    has_text_content = False

                tool_name = event.get("name", "unknown")
                tool_input = event.get("data", {}).get("input", {})
                tool_call_id = event.get("run_id", str(uuid.uuid4()))
                tool_call_count += 1

                logger.info(f"[TOOL #{tool_call_count}] START: {tool_name} | id={tool_call_id[:12]}...")
                logger.info(f"[TOOL #{tool_call_count}] INPUT: {json.dumps(safe_serialize(tool_input), default=str)[:200]}")

                # Track the tool call
                current_tool_calls[tool_call_id] = tool_name

                # Stream tool input - these are the SSE events the frontend needs to render
                yield protocol.tool_input_start(tool_call_id, tool_name)
                serialized_input = safe_serialize(tool_input)
                yield protocol.tool_input_delta(tool_call_id, json.dumps(serialized_input))
                yield protocol.tool_input_available(tool_call_id, tool_name, serialized_input)

            elif kind == "on_tool_end":
                tool_call_id = event.get("run_id", "")
                tool_output = event.get("data", {}).get("output")
                tool_name = current_tool_calls.get(tool_call_id, "unknown")

                logger.info(f"[TOOL] END: {tool_name} | id={tool_call_id[:12]}...")
                logger.info(f"[TOOL] OUTPUT: {str(tool_output)[:150]}...")

                # Send tool result - use larger limit to avoid truncating valid JSON
                # The UI components handle overflow/scrolling for large outputs
                truncated_output = truncate_output(tool_output, max_length=50000)
                yield protocol.tool_output_available(tool_call_id, truncated_output)

                # Remove from tracking
                current_tool_calls.pop(tool_call_id, None)

                # Signal step finished (agent may continue with more text)
                yield protocol.finish_step()

        # End any remaining text block
        if has_text_content:
            yield protocol.text_end()

        # Calculate duration
        duration = (datetime.now() - start_time).total_seconds()
        logger.info(f"[Stream] Complete: {tool_call_count} tools in {duration:.2f}s")

        # Finish the message
        yield protocol.finish()
        yield protocol.done()

    except Exception as e:
        duration = (datetime.now() - start_time).total_seconds()
        logger.error(f"[Stream] ERROR after {duration:.2f}s: {str(e)}")
        logger.error(f"[Stream] Traceback:\n{traceback.format_exc()}")
        # End text block if needed
        if has_text_content:
            yield protocol.text_end()
        yield protocol.error(str(e))
        yield protocol.done()


@router.post("/api/chat")
async def chat_sse(request: Request):
    """
    SSE endpoint compatible with Vercel AI SDK v5 / assistant-ui.
    Uses UI Message Stream Protocol v1.
    """
    try:
        body = await request.json()
    except Exception as e:
        logger.error(f"[API] Failed to parse request body: {e}")
        protocol = UIMessageStreamProtocol()
        async def error_stream():
            yield protocol.error(f"Invalid request body: {str(e)}")
            yield protocol.done()
        return StreamingResponse(
            error_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Vercel-AI-UI-Message-Stream": "v1",
            }
        )

    # AI SDK sends messages array
    messages = body.get("messages", [])

    if not messages:
        protocol = UIMessageStreamProtocol()
        async def error_stream():
            yield protocol.error("No messages provided")
            yield protocol.done()
        return StreamingResponse(
            error_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Vercel-AI-UI-Message-Stream": "v1",
            }
        )

    # Get the last user message
    last_message = messages[-1]

    # Extract text - handle BOTH formats:
    # 1. Standard AI SDK: { "content": "text" } or { "content": [{ "type": "text", "text": "..." }] }
    # 2. assistant-ui: { "parts": [{ "type": "text", "text": "..." }] }

    user_text = ""

    # Try "content" first (standard AI SDK format)
    user_content = last_message.get("content")
    if user_content:
        if isinstance(user_content, str):
            user_text = user_content
        elif isinstance(user_content, list):
            user_text = " ".join(
                part.get("text", "")
                for part in user_content
                if isinstance(part, dict) and part.get("type") == "text"
            )

    # Try "parts" if content is empty (assistant-ui format)
    if not user_text:
        parts = last_message.get("parts", [])
        if parts:
            user_text = " ".join(
                part.get("text", "")
                for part in parts
                if isinstance(part, dict) and part.get("type") == "text"
            )

    # Final fallback - check for direct text field
    if not user_text:
        user_text = last_message.get("text", "")

    if not user_text.strip():
        logger.warning("[API] Empty message content")
        protocol = UIMessageStreamProtocol()
        async def error_stream():
            yield protocol.error("Empty message")
            yield protocol.done()
        return StreamingResponse(
            error_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Vercel-AI-UI-Message-Stream": "v1",
            }
        )

    # ==========================================================================
    # Thread ID Management for Conversation Continuity
    # ==========================================================================
    #
    # Thread IDs link messages to the same conversation in the LangGraph checkpointer.
    # The backend handles generation, but the frontend MUST store and resend the ID.
    #
    # Flow:
    # 1. First message  - Frontend sends request WITHOUT threadId
    # 2. Backend        - Generates thread_id, saves to DB, returns in X-Thread-Id header
    # 3. Frontend       - Reads X-Thread-Id from response headers and stores it
    # 4. Next message   - Frontend sends request WITH threadId in body or header
    # 5. Backend        - Uses existing thread, continues conversation with full history
    #
    # If frontend doesn't persist the threadId, each message creates a NEW conversation
    # and the agent loses all context from previous messages.
    # ==========================================================================

    thread_id = body.get("threadId") or request.headers.get("x-thread-id")

    # If no thread ID provided, generate one (new conversation)
    if not thread_id or thread_id == "default":
        thread_id = f"thread_{uuid.uuid4().hex}"

    protocol = UIMessageStreamProtocol()

    return StreamingResponse(
        stream_agent_sse(user_text, thread_id, protocol),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Vercel-AI-UI-Message-Stream": "v1",
            "X-Thread-Id": thread_id,  # Return thread ID to frontend
        }
    )
