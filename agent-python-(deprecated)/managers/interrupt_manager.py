"""
Interrupt Manager - Bridges async Unity responses to agent interrupts.

When the agent hits an interrupt (e.g., waiting for compilation),
it creates a future here. When Unity sends the result, we resolve
that future, allowing the agent to continue.
"""

import asyncio
import logging

# Get logger and config from unity module
from unity.config import INTERRUPT_TIMEOUT

logger = logging.getLogger("movesia.interrupts")


class InterruptManager:
    """
    Manages pending interrupts waiting for Unity responses.
    """

    def __init__(self):
        self._pending: dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()

    async def create(self, request_id: str) -> asyncio.Future:
        """Create a future that will be resolved when Unity responds."""
        async with self._lock:
            if request_id in self._pending:
                self._pending[request_id].cancel()

            loop = asyncio.get_event_loop()
            future = loop.create_future()
            self._pending[request_id] = future
            return future

    async def resolve(self, request_id: str, result: dict):
        """Resolve a pending interrupt with Unity's result."""
        async with self._lock:
            if request_id in self._pending:
                future = self._pending.pop(request_id)
                if not future.done():
                    future.set_result(result)

    async def wait(self, request_id: str, timeout: float = INTERRUPT_TIMEOUT) -> dict:
        """Wait for an interrupt to be resolved."""
        future = await self.create(request_id)
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            async with self._lock:
                self._pending.pop(request_id, None)
            logger.error(f"Interrupt timed out: {request_id}")
            return {"success": False, "error": f"Operation timed out after {timeout}s"}

    async def cancel_all(self):
        """Cancel all pending interrupts."""
        async with self._lock:
            for request_id, future in self._pending.items():
                if not future.done():
                    future.cancel()
            self._pending.clear()
