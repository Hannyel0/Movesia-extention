# Improved WebSocket Connection Management for Movesia

This package provides a robust, production-ready WebSocket connection management system for the Movesia Unity integration. It implements best practices learned from both the TypeScript reference implementation and industry standards for WebSocket-based real-time systems.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        UnityManager                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    Connection Handling                              │ │
│  │                                                                     │ │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │ │
│  │  │   Session   │    │  Heartbeat  │    │   Message   │            │ │
│  │  │   Manager   │    │   Manager   │    │   Router    │            │ │
│  │  │             │    │             │    │             │            │ │
│  │  │ • Monotonic │    │ • Ping/Pong │    │ • Validate  │            │ │
│  │  │   takeover  │    │ • Idle det. │    │ • ACKs      │            │ │
│  │  │ • Session   │    │ • Compile   │    │ • Route     │            │ │
│  │  │   tracking  │    │   suspend   │    │   events    │            │ │
│  │  └─────────────┘    └─────────────┘    └─────────────┘            │ │
│  │                                                                     │ │
│  │  ┌─────────────────────────────────────────────────────────────┐  │ │
│  │  │                  Transport Layer                             │  │ │
│  │  │  • Standardized message envelopes (MovesiaMessage)          │  │ │
│  │  │  • Reliable delivery with ACKs                              │  │ │
│  │  │  • Broadcast support                                         │  │ │
│  │  └─────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                Command/Response Correlation                        │ │
│  │  • Request ID tracking                                             │ │
│  │  • Async futures for responses                                     │ │
│  │  • Timeout handling                                                │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Features

### 1. Session Management with Monotonic Takeover

Prevents issues with stale connections by ensuring newer connections always supersede older ones:

```python
# Connection sequence ensures newer connections win
decision = await sessions.accept(
    session_id="project-123",
    conn_seq=2,  # Higher than previous connection's seq=1
    connection=connection,
    websocket=websocket
)

if decision.supersede:
    # Close the old connection gracefully
    await decision.supersede.close(code=4001, reason="superseded")
```

This handles:
- Network interruptions where old connection lingers
- Unity domain reload creating new connections
- Client refresh while old connection is closing

### 2. Heartbeat with Compilation-Aware Suspension

```python
# Heartbeat automatically suspends during Unity compilation
heartbeat = HeartbeatManager(
    config=HeartbeatConfig(
        sweep_interval_ms=40_000,
        ping_after_idle_ms=90_000,
        max_idle_ms=600_000,
        compile_suspend_ms=120_000  # 2 minutes for compilation
    )
)

# When Unity starts compiling:
heartbeat.suspend(120_000)  # Automatically done by message router
```

### 3. Standardized Message Envelopes

All messages use a consistent format matching the TypeScript implementation:

```python
msg = MovesiaMessage.create(
    msg_type="query_hierarchy",
    body={"path": "/"},
    source=ConnectionSource.VSCODE,
    session="session-123"
)

# Serializes to:
# {
#     "v": 1,
#     "source": "vscode",
#     "type": "query_hierarchy",
#     "ts": 1703000000,
#     "id": "uuid-here",
#     "body": {"path": "/"},
#     "session": "session-123"
# }
```

### 4. Automatic ACK Handling

Important messages receive automatic acknowledgment:

```python
# These message types automatically get ACKs:
ACK_REQUIRED_TYPES = {
    "hello",
    "assets_imported",
    "assets_deleted",
    "scene_saved",
    "compile_started",
    "compile_finished",
    # ... etc
}

# Router handles this automatically
msg = await router.handle_message(ws, connection, raw_data)
# ACK is sent if msg.type in ACK_REQUIRED_TYPES
```

### 5. Command/Response Correlation

Send commands and wait for responses with timeout:

```python
# Simple API for tools
result = await unity_manager.send_and_wait(
    command_type="query_hierarchy",
    path="/",
    timeout=30.0
)

# Under the hood:
# 1. Generates unique request_id
# 2. Creates Future for response
# 3. Sends command
# 4. Waits for response with matching request_id
# 5. Returns response body or raises TimeoutError
```

## Installation

Copy the `improved_ws` folder into your agent directory:

```
agent/
├── improved_ws/
│   ├── __init__.py
│   ├── config.py
│   ├── types.py
│   ├── sessions.py
│   ├── heartbeat.py
│   ├── router.py
│   ├── transport.py
│   ├── unity_manager.py
│   └── routes/
│       ├── __init__.py
│       └── unity_ws.py
├── server.py  (your existing server)
└── ...
```

## Integration

### Basic Integration

```python
from fastapi import FastAPI
from improved_ws import UnityManager, Config, logger
from improved_ws.routes import unity_router, init_unity_routes

config = Config.from_env()

# Create manager
unity_manager = UnityManager()

# Initialize routes
init_unity_routes(unity_manager)

# Create app
app = FastAPI()
app.include_router(unity_router)

# Use in tools
async def my_tool():
    if not unity_manager.is_connected:
        return {"error": "Unity not connected"}
    
    result = await unity_manager.send_and_wait(
        "query_hierarchy",
        path="/"
    )
    return result
```

### With Interrupt Manager

For operations that need to survive Unity compilation:

```python
from improved_ws import UnityManager

class InterruptManager:
    # Your existing implementation
    pass

interrupt_manager = InterruptManager()
unity_manager = UnityManager(interrupt_manager=interrupt_manager)

# When Unity finishes compiling, interrupts can resume
unity_manager._on_domain_event = async def handle_event(msg):
    if msg.type == "compile_finished":
        await interrupt_manager.resume_all()
```

### Event Handling

Subscribe to Unity events:

```python
async def handle_unity_event(msg: MovesiaMessage):
    if msg.type == "hierarchy_changed":
        # React to hierarchy changes
        pass
    elif msg.type == "selection_changed":
        # React to selection changes
        pass

unity_manager = UnityManager(on_domain_event=handle_unity_event)
```

## Configuration

### Environment Variables

```bash
# Server
SERVER_HOST=127.0.0.1
SERVER_PORT=8765
LOG_LEVEL=INFO

# Unity
UNITY_HANDSHAKE_TIMEOUT=10.0
UNITY_COMMAND_TIMEOUT=30.0
INTERRUPT_TIMEOUT=120.0

# Heartbeat
HEARTBEAT_SWEEP_MS=40000
HEARTBEAT_PING_AFTER_MS=90000
HEARTBEAT_MAX_IDLE_MS=600000
COMPILE_SUSPEND_MS=120000
```

### Programmatic Configuration

```python
from improved_ws import Config, UnityManagerConfig, HeartbeatConfig

config = UnityManagerConfig(
    handshake_timeout=10.0,
    command_timeout=30.0,
    heartbeat=HeartbeatConfig(
        sweep_interval_ms=40_000,
        ping_after_idle_ms=90_000,
        max_idle_ms=600_000
    )
)

unity_manager = UnityManager(config=config)
```

## Unity-Side Protocol

### Handshake

Unity should send a handshake message immediately after connecting:

```json
{
    "project_path": "/path/to/unity/project",
    "unity_version": "2022.3.10f1",
    "session_id": "optional-session-id",
    "conn_seq": 1
}
```

### Message Format

All messages should follow the MovesiaMessage format:

```json
{
    "v": 1,
    "source": "unity",
    "type": "message_type",
    "ts": 1703000000,
    "id": "unique-message-id",
    "body": { },
    "session": "session-id"
}
```

### Compilation Events

Unity should send these during compilation:

```json
// When compilation starts
{
    "v": 1, "source": "unity", "type": "compile_started",
    "ts": 1703000000, "id": "...", "body": {}
}

// When compilation finishes
{
    "v": 1, "source": "unity", "type": "compile_finished",
    "ts": 1703000000, "id": "...", "body": {"success": true}
}
```

### Command Responses

Include `request_id` in response body:

```json
// Command from server
{
    "type": "query_hierarchy",
    "body": {"request_id": "abc-123", "path": "/"}
}

// Response from Unity
{
    "type": "query_hierarchy_response",
    "body": {
        "request_id": "abc-123",
        "hierarchy": [...]
    }
}
```

## Comparison with Original Implementation

| Feature | Original | Improved |
|---------|----------|----------|
| Session Management | Basic | Monotonic takeover |
| Heartbeat | None | Full ping/pong with suspend |
| Message Format | Ad-hoc | Standardized envelope |
| ACK Support | None | Automatic for important types |
| Command/Response | Manual | Correlation with timeout |
| Compilation Handling | Interrupt-based | Heartbeat suspend + interrupts |
| Connection Tracking | Single reference | Extended metadata |
| Type Safety | Minimal | Full dataclasses |

## Migration from Original

1. Replace `unity_manager.py` imports with `improved_ws`
2. Update endpoint to use new `handle_connection` signature
3. Command calls change from `send_and_wait(command)` to `send_and_wait(type, **params)`
4. Event handlers now receive `MovesiaMessage` instead of raw dict

```python
# Before
result = await unity_manager.send_and_wait({
    "type": "query_hierarchy",
    "request_id": "...",
    "path": "/"
})

# After
result = await unity_manager.send_and_wait(
    command_type="query_hierarchy",
    path="/"
)
# request_id is generated automatically
```

## Best Practices

1. **Always check connection before commands**
   ```python
   if not unity_manager.is_connected:
       return {"error": "Unity not connected"}
   ```

2. **Handle compilation state**
   ```python
   if unity_manager.is_compiling:
       # Wait or return appropriate response
   ```

3. **Use appropriate timeouts**
   ```python
   # Short for quick queries
   await unity_manager.send_and_wait("ping", timeout=5.0)
   
   # Longer for complex operations
   await unity_manager.send_and_wait("import_asset", timeout=60.0)
   ```

4. **Subscribe to events for reactive behavior**
   ```python
   async def on_hierarchy_change(msg):
       # Invalidate caches, update state, etc.
       pass
   ```

## Troubleshooting

### Connection keeps disconnecting

Check heartbeat configuration - may need to increase idle timeout:
```python
HeartbeatConfig(max_idle_ms=1200_000)  # 20 minutes
```

### Commands timeout during compilation

Ensure Unity sends `compile_started` and `compile_finished` events, and that the heartbeat suspend duration is sufficient.

### Duplicate connections rejected

This is expected behavior! Ensure Unity increments `conn_seq` on each reconnect.

### ACKs not received

Check that Unity properly echoes the message `id` in its ACK response.

## License

MIT - Part of the Movesia project.
