/**
 * THE ARTIST: unity_material
 * "I need to create, modify, or assign materials."
 * Consumes: material (unified endpoint)
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { callUnityAsync } from './connection';

/**
 * Color schema - [r, g, b] or [r, g, b, a] with floats 0-1
 */
const ColorSchema = z.union([
    z.tuple([z.number(), z.number(), z.number()]),
    z.tuple([z.number(), z.number(), z.number(), z.number()])
]).describe('Color as [r, g, b] or [r, g, b, a] with floats 0-1');

/**
 * Texture reference - can be instance ID, asset path, or object form
 */
const TextureRefSchema = z.union([
    z.number().int(),
    z.string(),
    z.object({ instanceId: z.number().int() }),
    z.object({ assetPath: z.string() })
]).describe('Texture: instanceId (int), asset path (string), or { instanceId } / { assetPath }');

/**
 * Vector schema for shader properties
 */
const VectorSchema = z.tuple([z.number(), z.number(), z.number(), z.number()])
    .describe('Vector as [x, y, z, w]');

/**
 * Material properties schema - supports friendly names that auto-resolve
 */
const PropertiesSchema = z.record(z.string(), z.union([
    ColorSchema,
    z.number(),
    z.string(),
    VectorSchema,
    z.object({ instanceId: z.number().int() }),
    z.object({ assetPath: z.string() })
])).optional().describe(`Material properties to set. Friendly names auto-resolve:
- color/baseColor/albedo → _BaseColor (URP) or _Color (Built-in)
- mainTexture/baseMap/mainTex → _BaseMap (URP) or _MainTex (Built-in)
- metallic → _Metallic
- smoothness/glossiness → _Smoothness (URP) or _Glossiness (Built-in)
- normalMap/bumpMap → _BumpMap
- emissionColor → _EmissionColor
- renderQueue → sets render queue directly (int)`);

/**
 * Keywords schema - object form { keyword: bool } or array form [keywords to enable]
 */
const KeywordsSchema = z.union([
    z.record(z.string(), z.boolean()),
    z.array(z.string())
]).optional().describe('Shader keywords. Object: { "_EMISSION": true }, or array: ["_EMISSION"]');

/**
 * Assignment target schema
 */
const AssignToSchema = z.object({
    game_object_instance_id: z.number().int()
        .describe('GameObject instance ID to assign material to (required)'),
    slot_index: z.number().int().default(0)
        .describe('Material slot index (default: 0)')
}).optional().describe('Assign material to a GameObject Renderer');

/**
 * Zod schema for unity_material tool input
 */
export const MaterialSchema = z.object({
    action: z.enum(['create', 'modify', 'assign', 'create_and_assign'])
        .describe('The material operation.'),

    // Identify existing material (omit both for CREATE)
    instance_id: z.number().int().optional()
        .describe('Instance ID of existing material to modify/assign.'),
    asset_path: z.string().optional()
        .describe("Asset path of existing material (e.g., 'Assets/Materials/Foo.mat')."),

    // Create params (only used when creating new)
    shader_name: z.string().optional()
        .describe("Full shader name (e.g., 'Universal Render Pipeline/Lit'). Auto-detects URP/Standard if omitted."),
    name: z.string().optional()
        .describe("Material name (default: 'NewMaterial')."),
    save_path: z.string().optional()
        .describe("Where to save new material (default: 'Assets/Materials/{name}.mat')."),

    // Modify params (applied whether creating or loading)
    properties: PropertiesSchema,
    keywords: KeywordsSchema,

    // Assign params
    assign_to: AssignToSchema
});

/** Type inferred from the Zod schema */
export type MaterialInput = z.infer<typeof MaterialSchema>;

/**
 * Create, modify, and assign materials. This is the "Artist".
 */
async function unityMaterialImpl(input: MaterialInput, _config?: any): Promise<string> {
    const {
        action,
        instance_id,
        asset_path,
        shader_name,
        name,
        save_path,
        properties,
        keywords,
        assign_to
    } = input;

    // Build the unified material message body
    const body: Record<string, unknown> = {};

    // Identification (for existing materials)
    if (instance_id !== undefined) {
        body.instanceId = instance_id;
    }
    if (asset_path !== undefined) {
        body.assetPath = asset_path;
    }

    // Creation params
    if (shader_name !== undefined) {
        body.shaderName = shader_name;
    }
    if (name !== undefined) {
        body.name = name;
    }
    if (save_path !== undefined) {
        body.savePath = save_path;
    }

    // Modification params
    if (properties !== undefined) {
        body.properties = properties;
    }
    if (keywords !== undefined) {
        body.keywords = keywords;
    }

    // Assignment params
    if (assign_to !== undefined) {
        body.assignTo = {
            gameObjectInstanceId: assign_to.game_object_instance_id,
            slotIndex: assign_to.slot_index ?? 0
        };
    }

    // Validate based on action
    switch (action) {
        case 'create':
            // Creating requires no instance_id/asset_path (or they're ignored)
            // Name is recommended but optional
            if (!name && !save_path) {
                // Warn but don't fail - Unity will use defaults
            }
            break;

        case 'modify':
            // Modifying requires identifying the material
            if (instance_id === undefined && asset_path === undefined) {
                return JSON.stringify({
                    error: "For 'modify', provide instance_id OR asset_path to identify the material",
                    hint: "Use unity_query({ action: 'search_assets', asset_type: 'material' }) to find materials",
                    example: "unity_material({ action: 'modify', asset_path: 'Assets/Materials/Red.mat', properties: { color: [1, 0, 0, 1] } })"
                }, null, 2);
            }
            if (properties === undefined && keywords === undefined) {
                return JSON.stringify({
                    error: "For 'modify', provide properties or keywords to change",
                    example: "unity_material({ action: 'modify', asset_path: 'Assets/Materials/Red.mat', properties: { metallic: 0.9 } })"
                }, null, 2);
            }
            break;

        case 'assign':
            // Assigning requires identifying the material AND a target
            if (instance_id === undefined && asset_path === undefined) {
                return JSON.stringify({
                    error: "For 'assign', provide instance_id OR asset_path to identify the material",
                    example: "unity_material({ action: 'assign', asset_path: 'Assets/Materials/Red.mat', assign_to: { game_object_instance_id: 12345 } })"
                }, null, 2);
            }
            if (assign_to === undefined) {
                return JSON.stringify({
                    error: "For 'assign', provide assign_to with the target GameObject",
                    example: "unity_material({ action: 'assign', asset_path: 'Assets/Materials/Red.mat', assign_to: { game_object_instance_id: 12345, slot_index: 0 } })"
                }, null, 2);
            }
            break;

        case 'create_and_assign':
            // Create + assign in one shot
            if (assign_to === undefined) {
                return JSON.stringify({
                    error: "For 'create_and_assign', provide assign_to with the target GameObject",
                    example: "unity_material({ action: 'create_and_assign', name: 'BluePlastic', properties: { color: [0, 0, 1, 1] }, assign_to: { game_object_instance_id: 12345 } })"
                }, null, 2);
            }
            break;

        default: {
            const _exhaustive: never = action;
            return JSON.stringify({ error: `Unknown action: ${_exhaustive}` }, null, 2);
        }
    }

    // Send to Unity via the unified 'material' endpoint
    const result = await callUnityAsync('material', body);

    return JSON.stringify(result, null, 2);
}

/**
 * The Artist - unity_material tool
 * Create, modify, and assign materials.
 */
export const unityMaterial = new DynamicStructuredTool({
    name: 'unity_material',
    description: `Create, modify, and assign materials. This is the "Artist".

Actions:
- 'create': Create a new material. Optionally specify shader_name, name, save_path, properties.
- 'modify': Change an existing material's properties/keywords. Requires instance_id OR asset_path.
- 'assign': Assign an existing material to a GameObject's Renderer. Requires instance_id OR asset_path + assign_to.
- 'create_and_assign': Create a new material AND assign it in one operation.

PROPERTY FORMAT (friendly names auto-resolve to shader properties):
- color/baseColor/albedo: [r, g, b, a] floats 0-1 (alpha optional)
- metallic: 0.0-1.0
- smoothness/glossiness: 0.0-1.0
- mainTexture/baseMap: asset path string or instanceId
- normalMap/bumpMap: asset path string or instanceId
- emissionColor: [r, g, b, a]
- renderQueue: int (special, sets render queue directly)

KEYWORDS (enable shader features):
- Object form: { "_EMISSION": true, "_NORMALMAP": false }
- Array form: ["_EMISSION", "_NORMALMAP"] (all enabled)

EXAMPLES:
Create red metallic material:
  unity_material({ action: 'create', name: 'RedMetal', properties: { color: [1,0,0,1], metallic: 0.9 } })

Modify existing material:
  unity_material({ action: 'modify', asset_path: 'Assets/Materials/RedMetal.mat', properties: { color: [0,0,1,1] } })

Assign material to object:
  unity_material({ action: 'assign', asset_path: 'Assets/Materials/RedMetal.mat', assign_to: { game_object_instance_id: 12345 } })

Create + configure + assign (one shot):
  unity_material({ action: 'create_and_assign', name: 'BluePlastic', shader_name: 'Universal Render Pipeline/Lit',
                   properties: { color: [0,0,1,1], metallic: 0.1, smoothness: 0.8 },
                   assign_to: { game_object_instance_id: 12345, slot_index: 0 } })`,
    schema: MaterialSchema,
    func: unityMaterialImpl
});
