/**
 * THE SCULPTOR: unity_probuilder
 * "I need to create and edit ProBuilder meshes."
 * Consumes: probuilder (unified endpoint)
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { callUnityAsync } from '../unity-tools/connection';

// ============================================================================
// Shared Schemas
// ============================================================================

/**
 * Color schema - [r, g, b] or [r, g, b, a] with floats 0-1
 */
const ColorSchema = z.union([
    z.tuple([z.number(), z.number(), z.number()]),
    z.tuple([z.number(), z.number(), z.number(), z.number()])
]).describe('Color as [r, g, b] or [r, g, b, a] with floats 0-1');

/**
 * Vector3 schema - [x, y, z]
 */
const Vector3Schema = z.tuple([z.number(), z.number(), z.number()])
    .describe('Vector3 as [x, y, z]');

/**
 * Inline material creation schema
 */
const InlineMaterialSchema = z.object({
    create: z.literal(true),
    shaderName: z.string().optional()
        .describe("Shader name (default: auto-detected URP Lit or Standard)"),
    name: z.string().optional()
        .describe("Material name"),
    savePath: z.string().optional()
        .describe("Asset path to save (omit for in-memory only)"),
    properties: z.record(z.string(), z.union([
        ColorSchema,
        z.number(),
        z.string()
    ])).optional().describe("Material properties: color, metallic, smoothness, etc.")
}).describe("Create new material inline");

/**
 * Material reference schema - supports multiple formats
 */
const MaterialRefSchema = z.union([
    z.number().int().describe("Instance ID of existing material"),
    z.string().describe("Asset path (e.g., 'Assets/Materials/Red.mat')"),
    z.object({ instanceId: z.number().int() }),
    z.object({ assetPath: z.string() }),
    InlineMaterialSchema
]).optional().describe("Material: instanceId, asset path, or inline { create: true, properties: {...} }");

/**
 * Face selection schema - supports shorthand and full form
 */
const FaceSelectionSchema = z.union([
    z.enum(['all', 'up', 'down', 'left', 'right', 'forward', 'back', 'front', 'backward'])
        .describe("Named direction with default 0.7 threshold"),
    z.object({
        method: z.enum(['direction', 'index']),
        direction: z.union([
            z.enum(['up', 'down', 'left', 'right', 'forward', 'back', 'front', 'backward']),
            Vector3Schema
        ]).optional().describe("Direction for method='direction'"),
        threshold: z.number().min(0).max(1).optional()
            .describe("Selection threshold 0-1 (default 0.7). Higher = tighter cone"),
        indices: z.array(z.number().int()).optional()
            .describe("Face indices for method='index'")
    })
]).optional().describe(`Face selection. Shorthand: "up", "down", etc. Full: { method: "direction", direction: "up", threshold: 0.9 } or { method: "index", indices: [0,1,5] }`);

/**
 * Pipeline step schema
 */
const PipelineStepSchema = z.object({
    op: z.enum(['extrude', 'subdivide', 'delete_faces', 'flip_normals', 'set_face_material', 'set_face_color', 'bevel'])
        .describe("Operation to perform"),
    faceSelection: FaceSelectionSchema,
    distance: z.number().optional().describe("For extrude/bevel"),
    extrudeMethod: z.enum(['FaceNormal', 'IndividualFaces', 'VertexNormal']).optional(),
    color: ColorSchema.optional().describe("For set_face_color"),
    material: MaterialRefSchema.describe("For set_face_material"),
    resultColor: ColorSchema.optional().describe("For extrude: color new faces"),
    resultMaterial: MaterialRefSchema.describe("For extrude: material for new faces")
}).describe("Pipeline step");

// ============================================================================
// Main Schema
// ============================================================================

/**
 * Zod schema for unity_probuilder tool input
 */
export const ProBuilderSchema = z.object({
    action: z.enum([
        'create_shape',
        'create_poly_shape',
        'get_mesh_info',
        'query_face_selection',
        'extrude',
        'set_face_material',
        'set_face_color',
        'delete_faces',
        'flip_normals',
        'subdivide',
        'bevel',
        'set_pivot',
        'bridge',
        'connect_edges',
        'merge',
        'pipeline'
    ]).describe('The ProBuilder action to perform.'),

    // Target identification
    instance_id: z.number().int().optional()
        .describe('Instance ID of existing ProBuilder mesh (required for most actions except create_*).'),

    // create_shape params
    shape_type: z.enum([
        'Cube', 'Box',
        'Cylinder',
        'Cone',
        'Plane',
        'Pipe', 'Tube',
        'Arch',
        'Stair', 'Stairs',
        'CurvedStair', 'CurvedStairs',
        'Door',
        'Torus', 'Donut',
        'Icosahedron', 'Sphere', 'Icosphere',
        'Prism', 'TriangularPrism'
    ]).optional().describe("Shape type for create_shape"),

    // Shape-specific params (flexibly support all shapes)
    size: Vector3Schema.optional().describe("Size [w,h,d] for Cube/Stair/Prism"),
    radius: z.number().optional().describe("Radius for Cylinder/Cone/Pipe/Arch/Torus/Icosahedron"),
    height: z.number().optional().describe("Height for Cylinder/Cone/Pipe/Arch/Stair/CurvedStair/Door"),
    sides: z.number().int().optional().describe("Subdivision axis (sides) for Cylinder/Cone/Pipe"),
    thickness: z.number().optional().describe("Thickness for Pipe"),
    width: z.number().optional().describe("Width for Plane/Arch/CurvedStair/Door"),
    depth: z.number().optional().describe("Depth for Arch/Door"),
    stair_steps: z.number().int().optional().describe("Number of steps for Stair/CurvedStair"),
    angle: z.number().optional().describe("Angle for Arch"),
    circumference: z.number().optional().describe("Circumference angle for Torus/CurvedStair"),
    inner_radius: z.number().optional().describe("Inner radius for Torus/CurvedStair"),
    outer_radius: z.number().optional().describe("Outer radius for Torus"),
    rows: z.number().int().optional().describe("Rows for Torus"),
    columns: z.number().int().optional().describe("Columns for Torus"),
    subdivisions: z.number().int().optional().describe("Subdivisions for Icosahedron"),
    smooth: z.union([z.boolean(), z.number()]).optional().describe("Smooth shading for Cylinder/Torus"),
    height_cuts: z.number().int().optional().describe("Height subdivisions for Cylinder/Plane"),
    width_cuts: z.number().int().optional().describe("Width subdivisions for Plane"),
    build_sides: z.boolean().optional().describe("Build sides for Stair/CurvedStair"),

    // Arch-specific
    radial_cuts: z.number().int().optional().describe("Radial cuts for Arch"),
    inside_faces: z.boolean().optional().describe("Inside faces for Arch"),
    outside_faces: z.boolean().optional().describe("Outside faces for Arch"),
    front_faces: z.boolean().optional().describe("Front faces for Arch"),
    back_faces: z.boolean().optional().describe("Back faces for Arch"),
    end_caps: z.boolean().optional().describe("End caps for Arch"),

    // Door-specific
    ledge_height: z.number().optional().describe("Ledge height for Door"),
    leg_width: z.number().optional().describe("Leg width for Door"),

    // Transform
    name: z.string().optional().describe("GameObject name"),
    position: Vector3Schema.optional().describe("World position [x, y, z]"),
    rotation: Vector3Schema.optional().describe("Euler rotation [x, y, z]"),
    scale: Vector3Schema.optional().describe("Local scale [x, y, z]"),

    // Material (inline creation supported)
    material: MaterialRefSchema,

    // Components to add
    components: z.array(z.string()).optional()
        .describe("Components to add (e.g., ['BoxCollider', 'Rigidbody'])"),

    // create_poly_shape params
    points: z.array(z.union([
        z.tuple([z.number(), z.number()]),
        z.tuple([z.number(), z.number(), z.number()])
    ])).optional().describe("Polygon points as [x,z] or [x,y,z] for create_poly_shape"),
    extrude_height: z.number().optional().describe("Extrusion height for create_poly_shape (default 1.0)"),
    flip_normals: z.boolean().optional().describe("Reverse winding for create_poly_shape"),

    // get_mesh_info params
    include_face_details: z.boolean().optional()
        .describe("Include per-face data (default true). Set false for summary only."),
    max_faces: z.number().int().optional()
        .describe("Max faces to return in detail (default 100)"),

    // Face operations
    face_selection: FaceSelectionSchema,
    distance: z.number().optional()
        .describe("Distance for extrude (negative = inward) or bevel amount"),
    extrude_method: z.enum(['FaceNormal', 'IndividualFaces', 'VertexNormal']).optional()
        .describe("Extrusion method (default: FaceNormal)"),
    color: ColorSchema.optional()
        .describe("Vertex color for set_face_color"),
    result_color: ColorSchema.optional()
        .describe("Vertex color for newly extruded faces"),
    result_material: MaterialRefSchema
        .describe("Material for newly extruded faces"),

    // set_pivot params
    pivot_location: z.union([
        z.enum(['center', 'firstVertex']),
        Vector3Schema
    ]).optional().describe("Pivot location: 'center', 'firstVertex', or [x,y,z] world position"),

    // bridge params
    edge_a: z.tuple([z.number().int(), z.number().int()]).optional()
        .describe("First edge as [v0, v1] vertex indices"),
    edge_b: z.tuple([z.number().int(), z.number().int()]).optional()
        .describe("Second edge as [v0, v1] vertex indices"),

    // merge params
    instance_ids: z.array(z.number().int()).optional()
        .describe("Array of ProBuilder mesh instance IDs to merge"),
    delete_originals: z.boolean().optional()
        .describe("Delete source meshes after merge (default true)"),

    // pipeline params
    pipeline_steps: z.array(PipelineStepSchema).optional()
        .describe("Array of operations to execute with single mesh rebuild")
});

/** Type inferred from the Zod schema */
export type ProBuilderInput = z.infer<typeof ProBuilderSchema>;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create and edit ProBuilder meshes. This is the "Sculptor".
 */
async function unityProBuilderImpl(input: ProBuilderInput, _config?: unknown): Promise<string> {
    const { action } = input;

    // Build the probuilder message body
    const body: Record<string, unknown> = { action };

    // Helper to add param if defined
    const addIfDefined = (bodyKey: string, value: unknown) => {
        if (value !== undefined) {
            body[bodyKey] = value;
        }
    };

    // Helper to convert snake_case input to camelCase for Unity
    const snakeToCamel = (s: string): string =>
        s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

    switch (action) {
        case 'create_shape': {
            if (!input.shape_type) {
                return JSON.stringify({
                    error: "shape_type is required for 'create_shape'",
                    hint: "Specify a shape: Cube, Cylinder, Cone, Plane, Pipe, Arch, Stair, CurvedStair, Door, Torus, Icosahedron, Prism",
                    example: "unity_probuilder({ action: 'create_shape', shape_type: 'Cube', size: [2, 3, 1] })"
                }, null, 2);
            }
            body.shapeType = input.shape_type;

            // Shape params
            addIfDefined('size', input.size);
            addIfDefined('radius', input.radius);
            addIfDefined('height', input.height);
            addIfDefined('subdivAxis', input.sides);
            addIfDefined('thickness', input.thickness);
            addIfDefined('width', input.width);
            addIfDefined('depth', input.depth);
            addIfDefined('steps', input.stair_steps);
            addIfDefined('angle', input.angle);
            addIfDefined('circumference', input.circumference);
            addIfDefined('innerRadius', input.inner_radius);
            addIfDefined('outerRadius', input.outer_radius);
            addIfDefined('rows', input.rows);
            addIfDefined('columns', input.columns);
            addIfDefined('subdivisions', input.subdivisions);
            addIfDefined('smooth', input.smooth);
            addIfDefined('heightCuts', input.height_cuts);
            addIfDefined('widthCuts', input.width_cuts);
            addIfDefined('buildSides', input.build_sides);

            // Arch-specific
            addIfDefined('radialCuts', input.radial_cuts);
            addIfDefined('insideFaces', input.inside_faces);
            addIfDefined('outsideFaces', input.outside_faces);
            addIfDefined('frontFaces', input.front_faces);
            addIfDefined('backFaces', input.back_faces);
            addIfDefined('endCaps', input.end_caps);

            // Door-specific
            addIfDefined('ledgeHeight', input.ledge_height);
            addIfDefined('legWidth', input.leg_width);

            // Transform & name
            addIfDefined('name', input.name);
            addIfDefined('position', input.position);
            addIfDefined('rotation', input.rotation);
            addIfDefined('scale', input.scale);

            // Material & components
            addIfDefined('material', input.material);
            addIfDefined('components', input.components);
            break;
        }

        case 'create_poly_shape': {
            if (!input.points || input.points.length < 3) {
                return JSON.stringify({
                    error: "points is required for 'create_poly_shape' (at least 3 points)",
                    hint: "Provide polygon vertices as [x,z] or [x,y,z] arrays",
                    example: "unity_probuilder({ action: 'create_poly_shape', points: [[0,0], [4,0], [4,3], [0,3]], extrude_height: 2 })"
                }, null, 2);
            }
            body.points = input.points;
            addIfDefined('extrude', input.extrude_height);
            addIfDefined('flipNormals', input.flip_normals);
            addIfDefined('name', input.name);
            addIfDefined('position', input.position);
            addIfDefined('material', input.material);
            addIfDefined('components', input.components);
            break;
        }

        case 'get_mesh_info': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'get_mesh_info'",
                    hint: "Use unity_query({ action: 'hierarchy' }) to find ProBuilder mesh instance IDs",
                    example: "unity_probuilder({ action: 'get_mesh_info', instance_id: 12345 })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            addIfDefined('includeFaceDetails', input.include_face_details);
            addIfDefined('maxFaces', input.max_faces);
            break;
        }

        case 'query_face_selection': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'query_face_selection'",
                    example: "unity_probuilder({ action: 'query_face_selection', instance_id: 12345, face_selection: 'up' })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            addIfDefined('faceSelection', input.face_selection);
            break;
        }

        case 'extrude': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'extrude'",
                    example: "unity_probuilder({ action: 'extrude', instance_id: 12345, face_selection: 'up', distance: 1.0 })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            addIfDefined('faceSelection', input.face_selection);
            addIfDefined('distance', input.distance);
            addIfDefined('extrudeMethod', input.extrude_method);
            addIfDefined('resultColor', input.result_color);
            addIfDefined('resultMaterial', input.result_material);
            break;
        }

        case 'set_face_material': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'set_face_material'",
                    example: "unity_probuilder({ action: 'set_face_material', instance_id: 12345, face_selection: 'up', material: { create: true, properties: { color: [1,0,0,1] } } })"
                }, null, 2);
            }
            if (input.material === undefined) {
                return JSON.stringify({
                    error: "material is required for 'set_face_material'",
                    hint: "Provide instance ID, asset path, or inline { create: true, properties: {...} }",
                    example: "unity_probuilder({ action: 'set_face_material', instance_id: 12345, material: 'Assets/Materials/Red.mat' })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            addIfDefined('faceSelection', input.face_selection);
            body.material = input.material;
            break;
        }

        case 'set_face_color': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'set_face_color'",
                    example: "unity_probuilder({ action: 'set_face_color', instance_id: 12345, color: [1, 0, 0, 1] })"
                }, null, 2);
            }
            if (input.color === undefined) {
                return JSON.stringify({
                    error: "color is required for 'set_face_color'",
                    example: "unity_probuilder({ action: 'set_face_color', instance_id: 12345, face_selection: 'up', color: [1, 0, 0, 1] })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            addIfDefined('faceSelection', input.face_selection);
            body.color = input.color;
            break;
        }

        case 'delete_faces': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'delete_faces'",
                    hint: "Use query_face_selection first to preview which faces will be deleted",
                    example: "unity_probuilder({ action: 'delete_faces', instance_id: 12345, face_selection: 'down' })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            addIfDefined('faceSelection', input.face_selection);
            break;
        }

        case 'flip_normals': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'flip_normals'",
                    example: "unity_probuilder({ action: 'flip_normals', instance_id: 12345 })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            addIfDefined('faceSelection', input.face_selection);
            break;
        }

        case 'subdivide': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'subdivide'",
                    example: "unity_probuilder({ action: 'subdivide', instance_id: 12345, face_selection: 'up' })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            addIfDefined('faceSelection', input.face_selection);
            break;
        }

        case 'bevel': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'bevel'",
                    example: "unity_probuilder({ action: 'bevel', instance_id: 12345, face_selection: 'up', distance: 0.1 })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            addIfDefined('faceSelection', input.face_selection);
            addIfDefined('distance', input.distance);
            break;
        }

        case 'set_pivot': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'set_pivot'",
                    example: "unity_probuilder({ action: 'set_pivot', instance_id: 12345, pivot_location: 'center' })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            addIfDefined('pivotLocation', input.pivot_location);
            break;
        }

        case 'bridge': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'bridge'",
                    example: "unity_probuilder({ action: 'bridge', instance_id: 12345, edge_a: [0, 1], edge_b: [4, 5] })"
                }, null, 2);
            }
            if (input.edge_a === undefined || input.edge_b === undefined) {
                return JSON.stringify({
                    error: "edge_a and edge_b are required for 'bridge'",
                    hint: "Use get_mesh_info to discover vertex indices for edges",
                    example: "unity_probuilder({ action: 'bridge', instance_id: 12345, edge_a: [0, 1], edge_b: [4, 5] })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            body.edgeA = input.edge_a;
            body.edgeB = input.edge_b;
            break;
        }

        case 'connect_edges': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'connect_edges'",
                    example: "unity_probuilder({ action: 'connect_edges', instance_id: 12345, face_selection: 'up' })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            addIfDefined('faceSelection', input.face_selection);
            break;
        }

        case 'merge': {
            if (!input.instance_ids || input.instance_ids.length < 2) {
                return JSON.stringify({
                    error: "instance_ids is required for 'merge' (at least 2 meshes)",
                    example: "unity_probuilder({ action: 'merge', instance_ids: [12345, 67890] })"
                }, null, 2);
            }
            body.instanceIds = input.instance_ids;
            addIfDefined('deleteOriginals', input.delete_originals);
            break;
        }

        case 'pipeline': {
            if (input.instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'pipeline'",
                    example: "unity_probuilder({ action: 'pipeline', instance_id: 12345, pipeline_steps: [{ op: 'extrude', faceSelection: 'up', distance: 1.0 }] })"
                }, null, 2);
            }
            if (!input.pipeline_steps || input.pipeline_steps.length === 0) {
                return JSON.stringify({
                    error: "pipeline_steps is required for 'pipeline' (at least 1 step)",
                    hint: "Supported ops: extrude, subdivide, delete_faces, flip_normals, set_face_material, set_face_color, bevel",
                    example: "unity_probuilder({ action: 'pipeline', instance_id: 12345, pipeline_steps: [{ op: 'flip_normals' }, { op: 'delete_faces', faceSelection: 'up' }] })"
                }, null, 2);
            }
            body.instanceId = input.instance_id;
            // Convert steps to Unity format (camelCase)
            body.steps = input.pipeline_steps.map(step => {
                const unityStep: Record<string, unknown> = { op: step.op };
                if (step.faceSelection !== undefined) unityStep.faceSelection = step.faceSelection;
                if (step.distance !== undefined) unityStep.distance = step.distance;
                if (step.extrudeMethod !== undefined) unityStep.extrudeMethod = step.extrudeMethod;
                if (step.color !== undefined) unityStep.color = step.color;
                if (step.material !== undefined) unityStep.material = step.material;
                if (step.resultColor !== undefined) unityStep.resultColor = step.resultColor;
                if (step.resultMaterial !== undefined) unityStep.resultMaterial = step.resultMaterial;
                return unityStep;
            });
            break;
        }

        default: {
            const _exhaustive: never = action;
            return JSON.stringify({ error: `Unknown action: ${_exhaustive}` }, null, 2);
        }
    }

    // Send to Unity via the 'probuilder' endpoint
    const result = await callUnityAsync('probuilder', body);
    return JSON.stringify(result, null, 2);
}

// ============================================================================
// Tool Export
// ============================================================================

/**
 * The Sculptor - unity_probuilder tool
 * Create and edit ProBuilder meshes for level design and prototyping.
 */
export const unityProBuilder = new DynamicStructuredTool({
    name: 'unity_probuilder',
    description: `Create and edit ProBuilder meshes. Actions: create_shape, create_poly_shape, pipeline, extrude, flip_normals, delete_faces, set_face_material, bevel, merge, get_mesh_info.`,
    schema: ProBuilderSchema,
    func: unityProBuilderImpl
});
