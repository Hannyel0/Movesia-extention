"""
Utility functions for Movesia Agent Server.
"""


def safe_serialize(obj) -> dict:
    """Safely serialize an object to JSON-compatible dict."""
    try:
        if isinstance(obj, dict):
            return {k: safe_serialize(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [safe_serialize(v) for v in obj]
        elif isinstance(obj, (str, int, float, bool, type(None))):
            return obj
        else:
            return str(obj)
    except:
        return str(obj)


def truncate_output(output, max_length: int = 1000) -> str:
    """Truncate large outputs for sending to client."""
    if output is None:
        return ""

    output_str = str(output)
    if len(output_str) > max_length:
        return output_str[:max_length] + f"... (truncated, {len(output_str)} total chars)"
    return output_str
