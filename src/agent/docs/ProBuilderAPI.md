# ProBuilder API Reference

Unified `"probuilder"` WebSocket endpoint for creating and editing ProBuilder meshes remotely via the AI agent.

---

## Message Format

Every message follows this envelope:

```json
{"type": "probuilder", "id": "req-1", "body": {"action": "...", ...params}}
```

All responses come back as `"probuilder_result"` with `instanceId` for stateless follow-up.

---

## Table of Contents

- [Shape Creation](#shape-creation)
  - [create_shape](#create_shape)
  - [create_poly_shape](#create_poly_shape)
- [Mesh Inspection](#mesh-inspection)
  - [get_mesh_info](#get_mesh_info)
  - [query_face_selection](#query_face_selection)
- [Face Selection System](#face-selection-system)
- [Face Operations](#face-operations)
  - [extrude](#extrude)
  - [set_face_material](#set_face_material)
  - [set_face_color](#set_face_color)
  - [delete_faces](#delete_faces)
  - [flip_normals](#flip_normals)
  - [subdivide](#subdivide)
  - [bevel](#bevel)
- [Mesh-Level Operations](#mesh-level-operations)
  - [set_pivot](#set_pivot)
  - [bridge](#bridge)
  - [connect_edges](#connect_edges)
  - [merge](#merge)
- [Pipeline](#pipeline)
- [Inline Material System](#inline-material-system)
- [Fuzzy Key Names](#fuzzy-key-names)
- [Typical Workflows](#typical-workflows)

---

## Shape Creation

### create_shape

Create a ProBuilder primitive shape. Supports 12 types.

```json
{"type": "probuilder", "id": "1", "body": {
  "action": "create_shape",
  "shapeType": "Cube",
  "size": [2, 3, 1],
  "name": "MyWall",
  "position": [0, 1.5, 0],
  "rotation": [0, 45, 0],
  "scale": [1, 1, 2]
}}
```

**Required:** `shapeType`

**Optional (all shapes):**

| Param | Type | Description |
|-------|------|-------------|
| `name` | string | GameObject name |
| `position` | [x,y,z] | World position |
| `rotation` | [x,y,z] | Euler angles |
| `scale` | [x,y,z] | Local scale |
| `material` | int/string/object | Inline material (see [Inline Material System](#inline-material-system)) |
| `components` | string[] | Components to add, e.g. `["BoxCollider", "Rigidbody"]` |

**Shape types and their specific params:**

| Shape | Aliases | Key Params |
|-------|---------|------------|
| `Cube` | `Box` | `size: [w,h,d]` (default [1,1,1]) |
| `Cylinder` | — | `radius` (0.5), `height` (1), `subdivAxis`/`sides` (24), `heightCuts` (0), `smooth` (1) |
| `Cone` | — | `radius` (0.5), `height` (1), `subdivAxis`/`sides` (6) |
| `Plane` | — | `width` (1), `height` (1), `widthCuts` (0), `heightCuts` (0) |
| `Pipe` | `Tube` | `radius` (1), `height` (2), `thickness` (0.25), `subdivAxis`/`sides` (8), `subdivHeight` (1) |
| `Arch` | — | `angle` (180), `radius` (1), `width` (0.5), `depth` (0.25), `radialCuts` (6), `insideFaces` (true), `outsideFaces` (true), `frontFaces` (true), `backFaces` (true), `endCaps` (true) |
| `Stair` | `Stairs` | `size: [w,h,d]` (default [2,2.5,4]), `steps` (6), `buildSides` (true) |
| `CurvedStair` | `CurvedStairs` | `stairWidth`/`width` (2), `height` (2.5), `innerRadius` (0.5), `circumference` (90), `steps` (8), `buildSides` (true) |
| `Door` | — | `totalWidth`/`width` (4), `totalHeight`/`height` (4), `ledgeHeight` (1), `legWidth` (1), `depth` (0.5) |
| `Torus` | `Donut` | `rows` (16), `columns` (24), `innerRadius` (0.25), `outerRadius`/`radius` (1), `smooth` (true), `circumference` (360) |
| `Icosahedron` | `Sphere`, `Icosphere` | `radius` (0.5), `subdivisions` (2) |
| `Prism` | `TriangularPrism` | `size: [w,h,d]` (default [1,1,1]) |

**With inline material + components (compound):**

```json
{"type": "probuilder", "id": "2", "body": {
  "action": "create_shape",
  "shapeType": "Cube",
  "size": [4, 3, 4],
  "name": "RedWall",
  "material": {
    "create": true,
    "shaderName": "Universal Render Pipeline/Lit",
    "name": "WallMat",
    "properties": {"color": [0.8, 0.2, 0.1, 1]}
  },
  "components": ["BoxCollider", "Rigidbody"]
}}
```

**Response:**

```json
{
  "success": true,
  "action": "create_shape",
  "instanceId": 12345,
  "name": "RedWall",
  "faceCount": 6,
  "vertexCount": 24,
  "edgeCount": 12,
  "materialInstanceId": 67890,
  "materialAssetPath": ""
}
```

---

### create_poly_shape

Create a mesh from a polygon outline extruded to a height.

```json
{"type": "probuilder", "id": "3", "body": {
  "action": "create_poly_shape",
  "points": [[0,0], [4,0], [4,3], [2,5], [0,3]],
  "extrude": 2.5,
  "name": "HouseShape",
  "position": [0, 0, 0],
  "material": {"create": true, "properties": {"color": [0.9, 0.85, 0.7, 1]}}
}}
```

**Required:** `points` (at least 3)

Points can be `[x, z]` (y defaults to 0) or `[x, y, z]`.

**Optional:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `extrude` | float | 1.0 | Extrusion height |
| `flipNormals` | bool | false | Reverse winding |
| `name` | string | "PolyShape" | GameObject name |
| `position` | [x,y,z] | — | World position |
| `components` | string[] | — | Components to add inline |
| `material` | int/string/object | — | Inline material |

---

## Mesh Inspection

### get_mesh_info

Read mesh data: face/vertex/edge counts, bounds, and optional per-face details.

**Summary mode (fast, no per-face data):**

```json
{"type": "probuilder", "id": "4", "body": {
  "action": "get_mesh_info",
  "instanceId": 12345,
  "includeFaceDetails": false
}}
```

**Detail mode with cap:**

```json
{"type": "probuilder", "id": "5", "body": {
  "action": "get_mesh_info",
  "instanceId": 12345,
  "maxFaces": 50
}}
```

**Required:** `instanceId`

**Optional:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `includeFaceDetails` | bool | true | Set false for summary only |
| `maxFaces` | int | 100 | Cap face detail array size |

**Response:**

```json
{
  "success": true,
  "action": "get_mesh_info",
  "instanceId": 12345,
  "name": "MyCube",
  "faceCount": 6,
  "vertexCount": 24,
  "edgeCount": 12,
  "boundsCenter": [0, 0, 0],
  "boundsSize": [1, 1, 1],
  "totalFaces": 6,
  "truncated": false,
  "faces": [
    {"index": 0, "normal": [0, 1, 0], "vertexCount": 4, "materialIndex": 0},
    {"index": 1, "normal": [0, -1, 0], "vertexCount": 4, "materialIndex": 0}
  ]
}
```

When `truncated: true`, `totalFaces` shows the actual count (may be > `faces.length`).

---

### query_face_selection

Read-only preview of which faces match a selection. No mesh mutation.

```json
{"type": "probuilder", "id": "6", "body": {
  "action": "query_face_selection",
  "instanceId": 12345,
  "faceSelection": {"method": "direction", "direction": "up", "threshold": 0.8}
}}
```

**Required:** `instanceId`, `faceSelection`

**Response:**

```json
{
  "success": true,
  "action": "query_face_selection",
  "instanceId": 12345,
  "name": "MyCube",
  "matchedFaces": 1,
  "totalFaces": 6,
  "faces": [
    {"index": 0, "normal": [0, 1, 0], "vertexCount": 4, "materialIndex": 0}
  ]
}
```

Use this to validate selection params before destructive operations like `delete_faces`.

---

## Face Selection System

Used by: `extrude`, `set_face_material`, `set_face_color`, `delete_faces`, `flip_normals`, `subdivide`, `bevel`, `query_face_selection`, and pipeline steps.

### Three methods:

**1. Omit entirely** — selects all faces (default)

**2. Shorthand string** — direction-based with 0.7 threshold:

```json
"faceSelection": "up"
```

```json
"faceSelection": "all"
```

**3. Full object:**

```json
// Direction-based (dot product of face normal vs direction)
"faceSelection": {"method": "direction", "direction": "up", "threshold": 0.9}

// Custom direction vector
"faceSelection": {"method": "direction", "direction": [0.5, 1, 0], "threshold": 0.7}

// By face indices (get indices from get_mesh_info first)
"faceSelection": {"method": "index", "indices": [0, 1, 5, 7]}

// All faces explicitly
"faceSelection": "all"
```

### Named directions:

| Name | Vector | Aliases |
|------|--------|---------|
| `up` | [0, 1, 0] | — |
| `down` | [0, -1, 0] | — |
| `left` | [-1, 0, 0] | — |
| `right` | [1, 0, 0] | — |
| `forward` | [0, 0, 1] | `front` |
| `back` | [0, 0, -1] | `backward` |

### Threshold:

The threshold (default 0.7, range 0-1) controls the cone of selection. A face is selected when `dot(faceNormal, direction) >= threshold`.

- `0.9` = tight selection (~25 degree cone, only faces nearly parallel to direction)
- `0.7` = moderate (~45 degree cone)
- `0.3` = wide selection (~72 degree cone)

---

## Face Operations

### extrude

Push selected faces outward (or inward with negative distance).

**Basic:**

```json
{"type": "probuilder", "id": "7", "body": {
  "action": "extrude",
  "instanceId": 12345,
  "faceSelection": "up",
  "distance": 0.5
}}
```

**With post-extrude styling (compound):**

```json
{"type": "probuilder", "id": "8", "body": {
  "action": "extrude",
  "instanceId": 12345,
  "faceSelection": {"method": "direction", "direction": "up", "threshold": 0.9},
  "distance": 1.0,
  "extrudeMethod": "FaceNormal",
  "resultColor": [1, 0, 0, 1],
  "resultMaterial": {"create": true, "properties": {"color": [0, 0.5, 1, 1]}}
}}
```

After extrusion, the `selectedFaces` list automatically references the new extruded top faces, so `resultColor` and `resultMaterial` apply to exactly those faces without a second call.

**Required:** `instanceId`

**Optional:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `faceSelection` | string/object | all | Which faces to extrude |
| `distance` | float | 0.5 | Extrusion distance (negative = inward) |
| `extrudeMethod` | string | "FaceNormal" | `"FaceNormal"`, `"IndividualFaces"`, `"VertexNormal"` |
| `resultColor` | [r,g,b,a] | — | Vertex color for extruded faces |
| `resultMaterial` | int/string/object | — | Material for extruded faces |

---

### set_face_material

Assign a material to selected faces. Supports inline material creation.

**With existing material:**

```json
{"type": "probuilder", "id": "9", "body": {
  "action": "set_face_material",
  "instanceId": 12345,
  "faceSelection": "up",
  "material": 67890
}}
```

**With inline material creation:**

```json
{"type": "probuilder", "id": "10", "body": {
  "action": "set_face_material",
  "instanceId": 12345,
  "faceSelection": {"method": "direction", "direction": "forward"},
  "material": {
    "create": true,
    "name": "BrickMat",
    "properties": {"color": [0.6, 0.3, 0.1, 1], "smoothness": 0.2}
  }
}}
```

**Required:** `instanceId`, `material`

Response includes `materialInstanceId` and `materialAssetPath` for reuse.

---

### set_face_color

Set vertex color on selected faces.

```json
{"type": "probuilder", "id": "11", "body": {
  "action": "set_face_color",
  "instanceId": 12345,
  "faceSelection": "down",
  "color": [0, 1, 0, 1]
}}
```

**Required:** `instanceId`, `color` ([r,g,b] or [r,g,b,a])

**Optional:** `faceSelection` (default: all)

---

### delete_faces

Remove selected faces from the mesh. **Destructive** — use `query_face_selection` first to preview.

```json
{"type": "probuilder", "id": "12", "body": {
  "action": "delete_faces",
  "instanceId": 12345,
  "faceSelection": "down"
}}
```

**Required:** `instanceId`

**Optional:** `faceSelection` (default: all — be careful!)

---

### flip_normals

Reverse face winding (makes faces face the opposite direction).

```json
{"type": "probuilder", "id": "13", "body": {
  "action": "flip_normals",
  "instanceId": 12345
}}
```

Classic use: create cube, flip all normals, get an instant room interior.

**Required:** `instanceId`

**Optional:** `faceSelection` (default: all)

---

### subdivide

Split faces by inserting edges from edge midpoints to face center.

```json
{"type": "probuilder", "id": "14", "body": {
  "action": "subdivide",
  "instanceId": 12345,
  "faceSelection": "up"
}}
```

**Required:** `instanceId`

**Optional:** `faceSelection` (default: all)

---

### bevel

Chamfer/bevel edges of selected faces.

```json
{"type": "probuilder", "id": "15", "body": {
  "action": "bevel",
  "instanceId": 12345,
  "faceSelection": "up",
  "distance": 0.1
}}
```

**Required:** `instanceId`

**Optional:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `faceSelection` | string/object | all | Edges collected from these faces |
| `distance` | float | 0.1 | Bevel amount |

---

## Mesh-Level Operations

### set_pivot

Move the pivot point of a ProBuilder mesh.

```json
{"type": "probuilder", "id": "16", "body": {
  "action": "set_pivot",
  "instanceId": 12345,
  "pivotLocation": "center"
}}
```

**Required:** `instanceId`

**Optional:** `pivotLocation` — one of:

| Value | Description |
|-------|-------------|
| `"center"` | Bounding box center (default) |
| `"firstVertex"` | First vertex position |
| `[x, y, z]` | Custom world position (vertices are offset so mesh doesn't visually move) |

---

### bridge

Create a new face between two edges (specified by vertex index pairs).

```json
{"type": "probuilder", "id": "17", "body": {
  "action": "bridge",
  "instanceId": 12345,
  "edgeA": [0, 1],
  "edgeB": [4, 5]
}}
```

**Required:** `instanceId`, `edgeA` ([v0, v1]), `edgeB` ([v0, v1])

Edge values are vertex index pairs. Use `get_mesh_info` to discover them.

---

### connect_edges

Insert new edges connecting selected face edges, creating new faces.

```json
{"type": "probuilder", "id": "18", "body": {
  "action": "connect_edges",
  "instanceId": 12345,
  "faceSelection": "up"
}}
```

**Required:** `instanceId`

**Optional:** `faceSelection` (default: all). Needs at least 2 edges.

---

### merge

Combine multiple ProBuilder meshes into one.

```json
{"type": "probuilder", "id": "19", "body": {
  "action": "merge",
  "instanceIds": [12345, 67890, 11111],
  "deleteOriginals": true
}}
```

**Required:** `instanceIds` (int[], at least 2)

**Optional:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `deleteOriginals` | bool | true | Destroy source GameObjects after merge |

The first mesh in the array becomes the target. Others are merged into it.

---

## Pipeline

Execute multiple operations on a single mesh with only **ONE** `RebuildMesh` call at the end. Instead of 5 separate messages (each causing `ToMesh + Refresh + Optimize`), send one message — ~5x less overhead.

### Basic example:

```json
{"type": "probuilder", "id": "20", "body": {
  "action": "pipeline",
  "instanceId": 12345,
  "steps": [
    {"op": "extrude", "faceSelection": "up", "distance": 1.0},
    {"op": "set_face_color", "faceSelection": "up", "color": [1, 0, 0, 1]},
    {"op": "subdivide", "faceSelection": "up"}
  ]
}}
```

### Complex example — styled platform:

```json
{"type": "probuilder", "id": "21", "body": {
  "action": "pipeline",
  "instanceId": 12345,
  "steps": [
    {
      "op": "extrude",
      "faceSelection": {"method": "direction", "direction": "up", "threshold": 0.9},
      "distance": 2.0,
      "resultMaterial": {"create": true, "name": "TopMat", "properties": {"color": [0, 0.5, 1, 1]}}
    },
    {
      "op": "bevel",
      "faceSelection": {"method": "direction", "direction": "up", "threshold": 0.9},
      "distance": 0.05
    },
    {
      "op": "set_face_material",
      "faceSelection": {"method": "direction", "direction": [0, -1, 0], "threshold": 0.9},
      "material": {"create": true, "name": "BottomMat", "properties": {"color": [0.3, 0.3, 0.3, 1]}}
    }
  ]
}}
```

### Room-from-cube pipeline:

```json
{"type": "probuilder", "id": "22", "body": {
  "action": "pipeline",
  "instanceId": 12345,
  "steps": [
    {"op": "flip_normals"},
    {"op": "delete_faces", "faceSelection": "up"},
    {
      "op": "set_face_material",
      "faceSelection": "down",
      "material": {"create": true, "name": "FloorMat", "properties": {"color": [0.6, 0.5, 0.4, 1]}}
    },
    {
      "op": "set_face_material",
      "faceSelection": {"method": "direction", "direction": [0, -1, 0], "threshold": 0.3},
      "material": {"create": true, "name": "WallMat", "properties": {"color": [0.9, 0.9, 0.85, 1]}}
    }
  ]
}}
```

### Supported step operations:

| `op` | Params | Description |
|------|--------|-------------|
| `extrude` | `faceSelection`, `distance`, `extrudeMethod`, `resultColor`, `resultMaterial` | Extrude faces with optional post-styling |
| `subdivide` | `faceSelection` | Split faces |
| `delete_faces` | `faceSelection` | Remove faces |
| `flip_normals` | `faceSelection` | Reverse winding |
| `set_face_material` | `faceSelection`, `material` | Assign material (supports inline creation) |
| `set_face_color` | `faceSelection`, `color` | Set vertex colors |
| `bevel` | `faceSelection`, `distance` | Bevel edges |

### Error handling:

Each step runs independently. A failed step doesn't block subsequent steps. You get per-step error reporting.

### Response:

```json
{
  "success": true,
  "action": "pipeline",
  "instanceId": 12345,
  "name": "MyCube",
  "faceCount": 18,
  "vertexCount": 56,
  "edgeCount": 27,
  "stepsExecuted": 3,
  "stepsTotal": 3,
  "stepResults": [
    {"stepIndex": 0, "operation": "extrude", "success": true, "error": null, "affectedFaces": 1},
    {"stepIndex": 1, "operation": "bevel", "success": true, "error": null, "affectedFaces": 4},
    {"stepIndex": 2, "operation": "set_face_material", "success": true, "error": null, "affectedFaces": 1}
  ]
}
```

`success` is `true` only when ALL steps succeed. `stepsExecuted` vs `stepsTotal` tells you how many passed.

---

## Inline Material System

Wherever a `material` param is accepted (`create_shape`, `create_poly_shape`, `set_face_material`, `extrude.resultMaterial`, pipeline steps), three formats work:

### 1. Instance ID (int)

```json
"material": 67890
```

Looks up an existing material by Unity instanceId.

### 2. Asset Path (string)

```json
"material": "Assets/Materials/Red.mat"
```

Loads material from the asset database. Auto-prepends `"Assets/"` if missing.

### 3. Inline Creation (object)

```json
"material": {
  "create": true,
  "shaderName": "Universal Render Pipeline/Lit",
  "name": "MyMaterial",
  "savePath": "Assets/Materials/MyMaterial.mat",
  "properties": {
    "color": [1, 0, 0, 1],
    "smoothness": 0.5,
    "metallic": 0.8
  }
}
```

Creates a new material via `MaterialManager.ManageMaterial()` inline. The response includes `materialInstanceId` and `materialAssetPath` so you can reuse it.

All fields except `create` are optional:
- `shaderName` defaults to auto-detected URP Lit or Standard
- `name` auto-generated if omitted
- `savePath` if omitted the material exists only in memory (not saved to disk)
- `properties` uses the same friendly aliases as the material endpoint (`color`, `smoothness`, `metallic`, `normalMap`, etc.)

### Reference by nested ID/path (object without create):

```json
"material": {"instanceId": 67890}
"material": {"assetPath": "Assets/Materials/Red.mat"}
```

---

## Fuzzy Key Names

All field names are fuzzy-matched. The normalization strips underscores and lowercases before lookup. These all resolve to the same canonical name:

| Canonical | Also accepts |
|-----------|-------------|
| `instanceId` | `instance_id`, `gameObjectInstanceId`, `goInstanceId`, `meshInstanceId`, `objectId`, `id` |
| `shapeType` | `shape_type`, `shape`, `meshType`, `primitiveType` |
| `faceSelection` | `face_selection`, `faces`, `selectFaces`, `selection` |
| `distance` | `amount`, `extrudeDistance` |
| `extrudeMethod` | `method`, `extrudeType` |
| `material` | `materialInstanceId`, `matInstanceId`, `materialId` |
| `position` | `pos`, `worldPosition` |
| `rotation` | `rot`, `eulerAngles`, `eulerRotation` |
| `name` | `gameObjectName`, `goName`, `objectName` |
| `color` | `vertexColor`, `faceColor` |
| `instanceIds` | `meshes`, `targets` |
| `deleteOriginals` | `destroyOriginals`, `removeSource` |
| `pivotLocation` | `pivot`, `pivotPoint`, `pivotPosition` |
| `points` | `controlPoints`, `vertices` |
| `components` | `addComponents` |
| `scale` | `localScale` |
| `resultColor` | `extrudeColor` |
| `resultMaterial` | `extrudeMaterial` |

Action names are also fuzzy: `"create_shape"`, `"CreateShape"`, `"create-shape"` all work.

---

## Typical Workflows

### Create a styled room

```
1. create_shape → Cube (4,3,4) with name "Room"
2. pipeline → flip_normals + delete_faces (up) + set_face_material (floor) + set_face_material (walls)
```

Or as a single pipeline after creation:

```json
{"type": "probuilder", "id": "1", "body": {
  "action": "create_shape", "shapeType": "Cube", "size": [4, 3, 4], "name": "Room"
}}
```

Then:

```json
{"type": "probuilder", "id": "2", "body": {
  "action": "pipeline",
  "instanceId": "<from response>",
  "steps": [
    {"op": "flip_normals"},
    {"op": "delete_faces", "faceSelection": "up"},
    {"op": "set_face_material", "faceSelection": "down",
     "material": {"create": true, "name": "Floor", "properties": {"color": [0.6, 0.5, 0.4, 1]}}},
    {"op": "set_face_material",
     "faceSelection": {"method": "direction", "direction": [0, -1, 0], "threshold": 0.3},
     "material": {"create": true, "name": "Walls", "properties": {"color": [0.95, 0.95, 0.9, 1]}}}
  ]
}}
```

### Build with extrusions

```
1. create_shape → Cube with inline material + BoxCollider
2. extrude → top faces up 2m with resultMaterial for the new surfaces
3. bevel → top edges for a polished look
```

### Validate before destroying

```
1. query_face_selection → check which faces match "down" with threshold 0.8
2. Review the matchedFaces count in the response
3. delete_faces → use the same selection
```

### Create multiple shapes and merge

```
1. create_shape → Cube "Base"
2. create_shape → Cylinder "Column" at offset position
3. merge → instanceIds of both, deleteOriginals: true
```

---

## All 16 Actions Summary

| # | Action | Description | Key Params |
|---|--------|-------------|------------|
| 1 | `create_shape` | Create primitive (12 types) | `shapeType`, shape params, `material`, `components` |
| 2 | `create_poly_shape` | Create from polygon outline | `points`, `extrude`, `material`, `components` |
| 3 | `get_mesh_info` | Inspect mesh data | `instanceId`, `includeFaceDetails`, `maxFaces` |
| 4 | `query_face_selection` | Preview face selection (read-only) | `instanceId`, `faceSelection` |
| 5 | `extrude` | Push faces outward/inward | `instanceId`, `faceSelection`, `distance`, `resultColor`, `resultMaterial` |
| 6 | `set_face_material` | Assign material to faces | `instanceId`, `faceSelection`, `material` |
| 7 | `set_face_color` | Set vertex colors | `instanceId`, `faceSelection`, `color` |
| 8 | `delete_faces` | Remove faces | `instanceId`, `faceSelection` |
| 9 | `flip_normals` | Reverse face winding | `instanceId`, `faceSelection` |
| 10 | `subdivide` | Split faces | `instanceId`, `faceSelection` |
| 11 | `bevel` | Chamfer edges | `instanceId`, `faceSelection`, `distance` |
| 12 | `set_pivot` | Move pivot point | `instanceId`, `pivotLocation` |
| 13 | `bridge` | Connect two edges | `instanceId`, `edgeA`, `edgeB` |
| 14 | `connect_edges` | Subdivide by connecting edges | `instanceId`, `faceSelection` |
| 15 | `merge` | Combine meshes | `instanceIds`, `deleteOriginals` |
| 16 | `pipeline` | Multi-step, single rebuild | `instanceId`, `steps[]` |
