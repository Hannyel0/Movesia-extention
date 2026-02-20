# Spatial Context API Reference

`get_spatial_context` gives the agent **computed vision** — world-space positions, bounds, and automatic alignment checks for objects in the scene. Instead of dumping the whole hierarchy, the agent queries only the objects it cares about and gets back the spatial insights a human would see at a glance.

---

## Message Format

```json
{"type": "get_spatial_context", "id": "req-1", "body": { ...params }}
```

Response type: `"spatial_context"`

---

## Table of Contents

- [Two Modes](#two-modes)
- [Focused Mode (Recommended)](#focused-mode-recommended)
  - [By Name](#by-name)
  - [By InstanceId](#by-instanceid)
  - [Both Together](#both-together)
- [Full Scene Mode](#full-scene-mode)
- [Parameters Reference](#parameters-reference)
- [Response Format](#response-format)
  - [Object Fields](#object-fields)
  - [Bounds Fields](#bounds-fields)
  - [Token-Saving Conventions](#token-saving-conventions)
- [Alignment Checks](#alignment-checks)
  - [What Gets Checked](#what-gets-checked)
  - [How Nearby Pairs Work](#how-nearby-pairs-work)
- [ProBuilder Enrichment](#probuilder-enrichment)
- [Typical Workflows](#typical-workflows)
  - [Create and Verify](#create-and-verify)
  - [Check After Modification](#check-after-modification)
  - [Broad Survey](#broad-survey)
- [Name Matching Rules](#name-matching-rules)
- [Fuzzy Key Names](#fuzzy-key-names)

---

## Two Modes

| Mode | When | How |
|------|------|-----|
| **Focused** | Agent knows which objects it cares about | Pass `names` and/or `instanceIds` |
| **Full Scene** | Agent needs a broad overview | Pass neither (empty body) |

**Always prefer focused mode.** Full scene mode returns every renderer in the scene and can bloat the context window on large scenes.

---

## Focused Mode (Recommended)

Returns **only** the requested objects + any nearby neighbors (within `maxDistance`). Alignment checks run on this small focused set.

### By Name

```json
{"type": "get_spatial_context", "id": "1", "body": {
  "names": ["Floor", "Walls", "Roof"]
}}
```

Name matching is **case-insensitive substring** — `"Wall"` matches `"Wall_Left"`, `"Walls"`, `"MyWall"`, etc.

### By InstanceId

Use instanceIds from previous create/modify responses:

```json
{"type": "get_spatial_context", "id": "2", "body": {
  "instanceIds": [-62980, -63100]
}}
```

### Both Together

```json
{"type": "get_spatial_context", "id": "3", "body": {
  "instanceIds": [-62980],
  "names": ["Roof"]
}}
```

Duplicates are automatically filtered — if a name resolves to an object already in instanceIds, it won't appear twice.

---

## Full Scene Mode

Omit both `names` and `instanceIds` to get all renderers in the scene:

```json
{"type": "get_spatial_context", "id": "4", "body": {}}
```

Capped at `maxObjects` (default 200). Sets `truncated: true` if the cap is hit. Skips "UI" and "Ignore Raycast" layers by default.

With filters:

```json
{"type": "get_spatial_context", "id": "5", "body": {
  "namePattern": "Wall",
  "tagFilter": "Architecture",
  "maxObjects": 50
}}
```

> **Warning:** Full scene mode on a scene with hundreds of props will return a lot of data. Use focused mode whenever possible.

---

## Parameters Reference

All parameters are optional.

### Focused Mode Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `names` | string[] | null | Find objects by name (case-insensitive substring match). Triggers focused mode |
| `instanceIds` | int[] | null | Find objects by Unity instanceId. Triggers focused mode |
| `maxDistance` | float | 0.5 | How far (meters) to search for nearby neighbors around focus objects. Also used as tolerance for alignment checks |

### Full Scene Mode Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `maxObjects` | int | 200 | Max objects returned. Sets `truncated: true` if exceeded |
| `namePattern` | string | null | Substring filter on GameObject names (full scene only) |
| `tagFilter` | string | null | Exact tag match filter (full scene only) |
| `includeInactive` | bool | false | Include inactive GameObjects (full scene only) |
| `skipDefaultLayers` | bool | true | Skip "UI" and "Ignore Raycast" layers (full scene only) |

### Shared Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `includeAlignmentChecks` | bool | true | Generate alignment check strings |
| `includeComponents` | bool | false | Include component names array per object. Off by default to save tokens |
| `minBoundsSize` | float | 0.1 | Min bounds magnitude for alignment checks. Tiny objects (< 0.1m) still appear in `objects` but are excluded from alignment pair checks |

---

## Response Format

```json
{
  "success": true,
  "objects": [ ... ],
  "alignmentChecks": [ ... ],
  "objectCount": 3,
  "proBuilderCount": 2,
  "truncated": false,
  "sceneNames": ["SampleScene"]
}
```

### Object Fields

Minimal object (default layer, no rotation, no scale, root object, not ProBuilder):

```json
{
  "name": "Floor",
  "instanceId": -62980,
  "position": [0.0, 0.0, 0.0],
  "bounds": {"min": [-5.0, -0.1, -4.0], "max": [5.0, 0.1, 4.0], "size": [10.0, 0.2, 8.0]}
}
```

Full object (all optional fields present):

```json
{
  "name": "Roof",
  "instanceId": -63200,
  "position": [3.0, 4.1, 0.0],
  "rotation": [0.0, 45.0, 0.0],
  "scale": [1.5, 1.0, 1.5],
  "bounds": {"min": [0.8, 3.1, -2.3], "max": [5.3, 5.1, 2.3], "size": [4.5, 2.0, 4.5]},
  "isProBuilder": true,
  "components": ["Transform", "MeshFilter", "MeshRenderer", "ProBuilderMesh"],
  "layer": "Architecture",
  "tag": "Building",
  "parentInstanceId": -63000,
  "parentName": "House",
  "faceCount": 6,
  "vertexCount": 24,
  "edgeCount": 12
}
```

| Field | Type | Always present? | Notes |
|-------|------|-----------------|-------|
| `name` | string | Yes | GameObject name |
| `instanceId` | int | Yes | Unity instanceId for follow-up commands |
| `position` | float[3] | Yes | World position, rounded to 1dp |
| `rotation` | float[3] | **Omitted** when [0,0,0] | Euler angles |
| `scale` | float[3] | **Omitted** when [1,1,1] | Local scale |
| `bounds.min` | float[3] | Yes | World-space AABB minimum corner |
| `bounds.max` | float[3] | Yes | World-space AABB maximum corner |
| `bounds.size` | float[3] | Yes | AABB dimensions (width, height, depth) |
| `isProBuilder` | bool | **Omitted** when false | True if object has ProBuilderMesh |
| `components` | string[] | **Omitted** unless `includeComponents: true` | Component type names |
| `layer` | string | **Omitted** when "Default" | Unity layer name |
| `tag` | string | **Omitted** when "Untagged" | Unity tag |
| `parentInstanceId` | int | **Omitted** when root (0) | Parent GO instanceId |
| `parentName` | string | **Omitted** when root (null) | Parent GO name |
| `faceCount` | int | **Omitted** when 0 | ProBuilder face count |
| `vertexCount` | int | **Omitted** when 0 | ProBuilder vertex count |
| `edgeCount` | int | **Omitted** when 0 | ProBuilder edge count |

### Bounds Fields

Bounds are world-space axis-aligned bounding boxes from `Renderer.bounds`. All floats rounded to 1 decimal place.

- `min` — lowest corner of the AABB
- `max` — highest corner of the AABB
- `size` — dimensions (max - min)
- To compute center: `center[i] = min[i] + size[i] / 2`

### Token-Saving Conventions

The response is designed to minimize token usage:

- All floats rounded to **1 decimal place** (e.g., 3.14159 becomes 3.1)
- `rotation` omitted when `[0,0,0]` (most objects)
- `scale` omitted when `[1,1,1]` (most objects)
- `layer` omitted when `"Default"` (most objects)
- `tag` omitted when `"Untagged"` (most objects)
- `parentInstanceId`/`parentName` omitted for root objects
- `isProBuilder` omitted when false
- ProBuilder stats omitted when 0
- `components` array off by default (opt-in via `includeComponents`)

A typical object with default settings uses **~80 tokens** instead of ~180.

---

## Alignment Checks

The `alignmentChecks` array contains human-readable spatial diagnostics — the same conclusions a human would draw from looking at the scene. The agent can act on them directly without doing any math.

### What Gets Checked

For each pair of nearby objects:

| Check | OK example | Warning example |
|-------|-----------|-----------------|
| **Vertical stacking** | `"✅ Walls bottom (0.1) matches Floor top (0.1)"` | `"⚠️ Walls bottom (0.2) vs Floor top (0.1) — vertical gap of 0.10m"` |
| **Horizontal centering** | *(no message when aligned)* | `"⚠️ Roof center.x (3.0) ≠ Walls center.x (0.0) — X misalignment of 3.0m"` |
| **Footprint comparison** | *(no message when similar)* | `"⚠️ Roof footprint [4.5, 4.5] smaller than Walls footprint [10.0, 8.0]"` |
| **Gap detection** | *(no message when flush)* | `"⚠️ Gap of 0.05m on X between Wall_Left and Wall_Right"` |

### How Nearby Pairs Work

- Only objects within `maxDistance` (default 0.5m) of each other are compared
- "Distance" = Euclidean gap between the two bounding boxes (0 if they overlap)
- Objects with `bounds.size.magnitude < minBoundsSize` (default 0.1m) are excluded from checks (prevents noise from tiny objects like debug gizmos)
- Tiny objects still appear in the `objects` array — they're just skipped for alignment

---

## ProBuilder Enrichment

When `com.unity.probuilder` is installed, ProBuilder meshes automatically get extra fields:

```json
{
  "name": "Floor",
  "instanceId": -62980,
  "position": [0.0, 0.0, 0.0],
  "bounds": {"min": [-5.0, -0.1, -4.0], "max": [5.0, 0.1, 4.0], "size": [10.0, 0.2, 8.0]},
  "isProBuilder": true,
  "faceCount": 6,
  "vertexCount": 24,
  "edgeCount": 12
}
```

When ProBuilder is not installed, these fields are omitted and `isProBuilder` is always omitted (false).

---

## Typical Workflows

### Create and Verify

The most common pattern: create objects, then check their spatial relationships.

```
1. Create Floor
   → {"type": "probuilder", "body": {"action": "create_shape", "shapeType": "Cube", "size": [10, 0.2, 8], "name": "Floor"}}
   ← response: {"instanceId": -62980, ...}

2. Create Walls
   → {"type": "probuilder", "body": {"action": "create_shape", "shapeType": "Cube", "size": [10, 3, 8], "position": [0, 1.6, 0], "name": "Walls"}}
   ← response: {"instanceId": -63100, ...}

3. Check spatial context (by name)
   → {"type": "get_spatial_context", "body": {"names": ["Floor", "Walls"]}}
   ← response includes both objects + alignment checks like:
      "✅ Walls bottom (0.1) matches Floor top (0.1)"

4. Create Roof (intentionally misaligned for demo)
   → {"type": "probuilder", "body": {"action": "create_shape", "shapeType": "Cube", "size": [4.5, 2, 4.5], "position": [3, 4.1, 0], "name": "Roof"}}

5. Check spatial context for all three
   → {"type": "get_spatial_context", "body": {"names": ["Floor", "Walls", "Roof"]}}
   ← alignment checks immediately reveal problems:
      "⚠️ Roof center.x (3.0) ≠ Walls center.x (0.0) — X misalignment of 3.0m"
      "⚠️ Roof footprint [4.5, 4.5] smaller than Walls footprint [10.0, 8.0]"

6. Agent fixes the roof position based on the warnings
```

### Check After Modification

After moving or resizing an object, verify it still fits:

```
1. Move an object
   → {"type": "set_transform", "body": {"instanceId": -63200, "position": [0, 3.1, 0]}}

2. Check it against neighbors
   → {"type": "get_spatial_context", "body": {"instanceIds": [-63200]}}
   ← returns the moved object + any nearby objects + alignment checks
```

### Broad Survey

When the agent first enters a scene and needs to understand what exists:

```
→ {"type": "get_spatial_context", "body": {"maxObjects": 20}}
← returns up to 20 renderers with positions and bounds

→ {"type": "get_spatial_context", "body": {"namePattern": "Wall"}}
← returns only objects with "Wall" in their name
```

---

## Name Matching Rules

When using `names` in focused mode:

- **Case-insensitive**: `"floor"` matches `"Floor"`
- **Substring**: `"Wall"` matches `"Wall_Left"`, `"Walls"`, `"MyWall"`
- **Multiple matches**: `"Wall"` returns ALL matching objects
- **Exact path**: `"House/Roof"` works via `GameObject.Find` for hierarchical paths
- **Deduplication**: if `names` and `instanceIds` resolve to the same object, it appears once

---

## Fuzzy Key Names

The API accepts common misspellings and alternative key names. Normalization strips underscores and lowercases before lookup.

| Canonical | Also accepts |
|-----------|-------------|
| `names` | `objectNames`, `gameObjectNames`, `objects`, `focus` |
| `instanceIds` | `ids`, `focusObjects`, `targets`, `targetIds`, `gameObjectIds` |
| `maxDistance` | `distance`, `tolerance`, `range`, `nearbyDistance` |
| `maxObjects` | `limit`, `maxCount`, `objectLimit`, `maxResults` |
| `minBoundsSize` | `minSize`, `minimumSize`, `minBounds`, `boundsThreshold` |
| `includeAlignmentChecks` | `alignmentChecks`, `alignment`, `checkAlignment`, `checks` |
| `includeComponents` | `components`, `showComponents`, `withComponents` |
| `includeInactive` | `inactive`, `showInactive`, `withInactive` |
| `skipDefaultLayers` | `skipLayers`, `filterLayers`, `defaultLayers` |
| `namePattern` | `name`, `filter`, `nameFilter`, `search`, `pattern` |
| `tagFilter` | `tag`, `filterTag` |

All variations also work with underscores, camelCase, PascalCase, etc.:
`max_distance`, `MaxDistance`, `MAX_DISTANCE` all resolve to `maxDistance`.
