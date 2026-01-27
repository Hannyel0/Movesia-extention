# Refresh Assets API

Triggers Unity's asset database refresh and script recompilation. This is essential after creating or modifying C# scripts, as Unity must recompile before new components become available.

## Message Type

```
refresh_assets
```

## Category

Scripts

## Request Format

```json
{
  "type": "refresh_assets",
  "id": "req-1234567890-abc123",
  "body": {
    "watchedScripts": ["PlayerHealth", "EnemyAI"],
    "typeLimit": 20
  }
}
```

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `watchedScripts` | string[] | No | - | Script names to verify exist after compilation completes. Useful for confirming that newly created scripts compiled successfully. |
| `typeLimit` | number | No | 20 | Maximum number of types to return in the response. Use this to limit response size when only checking a few types. |

> **Note:** The `customOnly` parameter is deprecated and no longer affects behavior. The API now always returns only custom scripts (excluding Unity built-in types).

## Response Format

```json
{
  "type": "refresh_assets",
  "id": "req-1234567890-abc123",
  "success": true,
  "body": {
    "availableTypes": [
      "PlayerHealth",
      "EnemyAI",
      "GameManager",
      "UIController"
    ],
    "watchedScriptsStatus": {
      "PlayerHealth": true,
      "EnemyAI": true
    },
    "compilationErrors": []
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `availableTypes` | string[] | List of available custom component types after compilation. Limited by `typeLimit`. |
| `watchedScriptsStatus` | object | Map of watched script names to their existence status (true if found, false if missing). Only present if `watchedScripts` was provided. |
| `compilationErrors` | string[] | List of any compilation errors encountered. Empty if compilation succeeded. |

## Usage Examples

### Basic Refresh

Trigger a refresh and get available types:

```json
{
  "type": "refresh_assets",
  "id": "req-001",
  "body": {}
}
```

### Verify Script Creation

After creating a new script, verify it compiled successfully:

```json
{
  "type": "refresh_assets",
  "id": "req-002",
  "body": {
    "watchedScripts": ["NewPlayerController"]
  }
}
```

### Limit Response Size

When you only need to check a few types:

```json
{
  "type": "refresh_assets",
  "id": "req-003",
  "body": {
    "typeLimit": 5
  }
}
```

## Common Workflow

1. **Create/Modify Script** - Write or update a C# script file in the Unity project
2. **Call refresh_assets** - Trigger asset database refresh and recompilation
3. **Check Response** - Verify the script appears in `availableTypes` or check `watchedScriptsStatus`
4. **Use Component** - Once confirmed, the script can be attached to GameObjects via `add_component`

## Error Handling

If compilation fails, the response will include error details:

```json
{
  "type": "refresh_assets",
  "id": "req-004",
  "success": false,
  "body": {
    "availableTypes": [],
    "compilationErrors": [
      "Assets/Scripts/PlayerHealth.cs(15,10): error CS1002: ; expected"
    ]
  }
}
```

## Related APIs

| API | Description |
|-----|-------------|
| `get_compilation_status` | Check compilation state without triggering a refresh |
| `get_available_types` | List all available component types with filtering options |
| `add_component` | Attach a component to a GameObject (requires compiled scripts) |

## Notes

- This API blocks until Unity's compilation completes
- Large projects may take several seconds to recompile
- If compilation is already in progress, the API waits for it to finish
- The `watchedScripts` parameter is useful for verifying specific scripts without checking the entire available types list
