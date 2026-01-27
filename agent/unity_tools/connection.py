"""
Shared connection utilities for Unity middleware communication.
"""
import httpx
import json

# ═══════════════════════════════════════════════════════════════
# Connection
# ═══════════════════════════════════════════════════════════════
MIDDLEWARE_URL = "http://127.0.0.1:8766/query"


def call_unity(action: str, **params) -> dict:
    """Send a request to the Unity middleware."""
    payload = {"action": action, "params": params}
    print(f"DEBUG call_unity: {json.dumps(payload)}")
    response = httpx.post(MIDDLEWARE_URL, json=payload, timeout=60.0)
    return response.json()
