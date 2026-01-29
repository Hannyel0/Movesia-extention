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
        logger.debug(f"[Protocol] Created new protocol instance: message_id={self.message_id}")

    def _sse(self, data: dict) -> str:
        """Format as SSE data line."""
        result = f"data: {json.dumps(data)}\n\n"
        logger.debug(f"[Protocol] SSE event: {data.get('type', 'unknown')}")
        return result

    def start(self) -> str:
        """Start a new assistant message."""
        logger.info(f"[Protocol] Starting message: {self.message_id}")
        return self._sse({"type": "start", "messageId": self.message_id})

    def text_start(self) -> str:
        """Start text content block."""
        self.text_started = True
        logger.debug(f"[Protocol] Text block started: {self.text_id}")
        return self._sse({"type": "text-start", "id": self.text_id})

    def text_delta(self, content: str) -> str:
        """Stream text delta."""
        if not content:
            return ""
        return self._sse({"type": "text-delta", "id": self.text_id, "delta": content})

    def text_end(self) -> str:
        """End text content block."""
        if not self.text_started:
            logger.warning("[Protocol] text_end called but text was not started")
            return ""
        self.text_started = False
        logger.debug(f"[Protocol] Text block ended: {self.text_id}")
        return self._sse({"type": "text-end", "id": self.text_id})

    def tool_input_start(self, tool_call_id: str, tool_name: str) -> str:
        """Start tool input streaming."""
        logger.info(f"[Protocol] Tool input start: {tool_name} (id={tool_call_id})")
        return self._sse({
            "type": "tool-input-start",
            "toolCallId": tool_call_id,
            "toolName": tool_name
        })

    def tool_input_delta(self, tool_call_id: str, delta: str) -> str:
        """Stream tool input delta."""
        return self._sse({
            "type": "tool-input-delta",
            "toolCallId": tool_call_id,
            "inputTextDelta": delta
        })

    def tool_input_available(self, tool_call_id: str, tool_name: str, input_data: Any) -> str:
        """Tool input is fully available."""
        logger.debug(f"[Protocol] Tool input available: {tool_name}")
        return self._sse({
            "type": "tool-input-available",
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "input": input_data
        })

    def tool_output_available(self, tool_call_id: str, output: Any) -> str:
        """Tool output is available."""
        logger.debug(f"[Protocol] Tool output available: {tool_call_id}")
        return self._sse({
            "type": "tool-output-available",
            "toolCallId": tool_call_id,
            "output": output
        })

    def finish_step(self) -> str:
        """Finish a step (after tool calls, before continuing)."""
        logger.debug("[Protocol] Step finished")
        return self._sse({"type": "finish-step"})

    def finish(self) -> str:
        """Finish the message."""
        logger.info(f"[Protocol] Message finished: {self.message_id}")
        return self._sse({"type": "finish"})

    def error(self, message: str) -> str:
        """Report an error."""
        logger.error(f"[Protocol] Error: {message}")
        return self._sse({"type": "error", "errorText": message})

    def done(self) -> str:
        """Signal end of stream."""
        logger.debug("[Protocol] Stream done")
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
    token_count = 0
    event_count = 0
    start_time = datetime.now()

    logger.info(f"[Stream] Starting agent stream for thread={thread_id}")
    logger.debug(f"[Stream] Input data: {input_data}")

    try:
        # Start the message
        logger.info(f"[Stream] User message: \"{user_message[:100]}{'...' if len(user_message) > 100 else ''}\"")
        yield protocol.start()

        logger.debug("[Stream] Beginning astream_events iteration...")

        async for event in _graph.astream_events(input_data, config=config, version="v2"):
            event_count += 1
            kind = event.get("event")

            # Log every 10th event to avoid spam, but always log important events
            if event_count <= 5 or event_count % 10 == 0 or kind in ["on_tool_start", "on_tool_end"]:
                logger.debug(f"[Stream] Event #{event_count}: {kind}")

            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content"):
                    content = chunk.content
                    # Handle both string and list content
                    if isinstance(content, str) and content:
                        # Start text block if not already started
                        if not has_text_content:
                            logger.debug("[Stream] Starting text content block")
                            yield protocol.text_start()
                            has_text_content = True
                        token_count += 1
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
                                    logger.debug("[Stream] Starting text content block (from list)")
                                    yield protocol.text_start()
                                    has_text_content = True
                                token_count += 1
                                yield protocol.text_delta(text)

            elif kind == "on_tool_start":
                # End any ongoing text block before tool call
                if has_text_content:
                    logger.debug("[Stream] Ending text block before tool call")
                    yield protocol.text_end()
                    has_text_content = False

                tool_name = event.get("name", "unknown")
                tool_input = event.get("data", {}).get("input", {})
                tool_call_id = event.get("run_id", str(uuid.uuid4()))

                logger.info(f"[Stream] Tool call started: {tool_name} (id={tool_call_id})")
                logger.debug(f"[Stream] Tool input: {str(tool_input)[:200]}")

                # Track the tool call
                current_tool_calls[tool_call_id] = tool_name

                # Stream tool input
                yield protocol.tool_input_start(tool_call_id, tool_name)
                serialized_input = safe_serialize(tool_input)
                yield protocol.tool_input_delta(tool_call_id, json.dumps(serialized_input))
                yield protocol.tool_input_available(tool_call_id, tool_name, serialized_input)

            elif kind == "on_tool_end":
                tool_call_id = event.get("run_id", "")
                tool_output = event.get("data", {}).get("output")
                tool_name = current_tool_calls.get(tool_call_id, "unknown")

                logger.info(f"[Stream] Tool call completed: {tool_name} (id={tool_call_id})")
                logger.debug(f"[Stream] Tool output: {str(tool_output)[:200]}")

                # Send tool result
                truncated_output = truncate_output(tool_output, max_length=2000)
                yield protocol.tool_output_available(tool_call_id, truncated_output)

                # Remove from tracking
                current_tool_calls.pop(tool_call_id, None)

                # Signal step finished (agent may continue with more text)
                yield protocol.finish_step()

        # End any remaining text block
        if has_text_content:
            logger.debug("[Stream] Ending remaining text block")
            yield protocol.text_end()

        # Calculate duration
        duration = (datetime.now() - start_time).total_seconds()
        logger.info(f"[Stream] Completed successfully: {token_count} tokens, {event_count} events in {duration:.2f}s")

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
    logger.info("=" * 60)
    logger.info("[API] POST /api/chat - Request received")

    try:
        body = await request.json()
        logger.debug(f"[API] Request body keys: {list(body.keys())}")
        logger.debug(f"[API] Request headers: {dict(request.headers)}")
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
    logger.info(f"[API] Received {len(messages)} messages")

    if not messages:
        logger.warning("[API] No messages in request body")
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
    logger.debug(f"[API] Last message: {json.dumps(last_message, default=str)[:500]}")

    # Extract text - handle BOTH formats:
    # 1. Standard AI SDK: { "content": "text" } or { "content": [{ "type": "text", "text": "..." }] }
    # 2. assistant-ui: { "parts": [{ "type": "text", "text": "..." }] }

    user_text = ""

    # Try "content" first (standard AI SDK format)
    user_content = last_message.get("content")
    if user_content:
        logger.debug(f"[API] Found 'content' field, type: {type(user_content).__name__}")
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
            logger.debug(f"[API] Found 'parts' field with {len(parts)} parts")
            user_text = " ".join(
                part.get("text", "")
                for part in parts
                if isinstance(part, dict) and part.get("type") == "text"
            )

    # Final fallback - check for direct text field
    if not user_text:
        user_text = last_message.get("text", "")
        if user_text:
            logger.debug("[API] Found 'text' field")

    logger.info(f"[API] Extracted user text: \"{user_text[:100]}{'...' if len(user_text) > 100 else ''}\"")

    if not user_text.strip():
        logger.warning("[API] Empty message content after extraction")
        logger.warning(f"[API] Last message structure: {json.dumps(last_message, default=str)}")
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
    logger.debug(f"[API] Thread ID from request: {thread_id}")

    # If no thread ID provided, generate one (new conversation)
    if not thread_id or thread_id == "default":
        thread_id = f"thread_{uuid.uuid4().hex}"
        logger.info(f"[API] Generated new thread ID: {thread_id}")
    else:
        logger.info(f"[API] Using existing thread ID: {thread_id}")

    protocol = UIMessageStreamProtocol()

    logger.info(f"[API] Starting SSE stream response...")
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
