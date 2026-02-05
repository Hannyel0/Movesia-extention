/**
 * THE FACTORY: unity_prefab
 * "I need to use or create templates."
 * Consumes: instantiate_prefab, instantiate_prefab_by_name, create_prefab,
 *           modify_prefab, revert_prefab, apply_prefab
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { callUnityAsync } from './connection';

/**
 * Zod schema for unity_prefab tool input
 */
export const PrefabSchema = z.object({
    action: z.enum(['instantiate', 'instantiate_by_name', 'create_asset', 'modify_asset', 'apply', 'revert'])
        .describe('The prefab operation.'),

    // Asset paths/Names
    asset_path: z.string().optional()
        .describe("Path to .prefab file (e.g., 'Assets/Prefabs/Player.prefab')."),
    prefab_name: z.string().optional()
        .describe("Name for 'instantiate_by_name'."),

    // Instance Targets
    instance_id: z.number().int().optional()
        .describe('Scene Instance ID for apply/revert/create_asset.'),

    // Positioning
    position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0])
        .describe('Spawn position [x, y, z].'),
    rotation: z.tuple([z.number(), z.number(), z.number()]).optional()
        .describe('Spawn rotation [x, y, z] in euler angles.'),

    // Asset Modification
    component_type: z.string().optional()
        .describe('Component to edit on the prefab ASSET directly.'),
    properties: z.record(z.string(), z.unknown()).optional()
        .describe('Properties to edit on the prefab ASSET.')
});

/** Type inferred from the Zod schema */
export type PrefabInput = z.infer<typeof PrefabSchema>;

/**
 * Manage Prefab Assets and Instances. This is the "Factory".
 */
async function unityPrefabImpl(input: PrefabInput, _config?: any): Promise<string> {
    const {
        action,
        asset_path,
        prefab_name,
        instance_id,
        position = [0, 0, 0],
        rotation,
        component_type,
        properties
    } = input;

    let result;

    switch (action) {
        case 'instantiate':
            if (asset_path === undefined) {
                return JSON.stringify({
                    error: "asset_path is required for 'instantiate'",
                    hint: "Use 'instantiate_by_name' if you only know the prefab name, or search with unity_query({ action: 'search_assets' })",
                    example: "unity_prefab({ action: 'instantiate', asset_path: 'Assets/Prefabs/Enemy.prefab', position: [0, 0, 5] })"
                }, null, 2);
            }
            {
                const params: Record<string, unknown> = { assetPath: asset_path, position };
                if (rotation) params.rotation = rotation;
                result = await callUnityAsync('instantiate_prefab', params);
            }
            break;

        case 'instantiate_by_name':
            if (prefab_name === undefined) {
                return JSON.stringify({
                    error: "prefab_name is required for 'instantiate_by_name'",
                    hint: "Provide the prefab name (without path or .prefab extension)",
                    example: "unity_prefab({ action: 'instantiate_by_name', prefab_name: 'Enemy', position: [0, 0, 5] })"
                }, null, 2);
            }
            {
                const params: Record<string, unknown> = { prefabName: prefab_name, position };
                if (rotation) params.rotation = rotation;
                result = await callUnityAsync('instantiate_prefab_by_name', params);
            }
            break;

        case 'create_asset':
            if (instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'create_asset'",
                    hint: "First use unity_query({ action: 'hierarchy' }) to find the GameObject ID to turn into a prefab",
                    example: "unity_prefab({ action: 'create_asset', instance_id: -74268, asset_path: 'Assets/Prefabs/NewPrefab.prefab' })"
                }, null, 2);
            }
            if (asset_path === undefined) {
                return JSON.stringify({
                    error: "asset_path is required for 'create_asset'",
                    hint: "Specify where to save the new prefab (must end with .prefab)",
                    example: "unity_prefab({ action: 'create_asset', instance_id: -74268, asset_path: 'Assets/Prefabs/NewPrefab.prefab' })"
                }, null, 2);
            }
            result = await callUnityAsync('create_prefab', {
                instanceId: instance_id,
                savePath: asset_path
            });
            break;

        case 'modify_asset':
            if (asset_path === undefined) {
                return JSON.stringify({
                    error: "asset_path is required for 'modify_asset'",
                    hint: "Use unity_query({ action: 'search_assets', asset_type: 'prefab' }) to find prefab paths",
                    example: "unity_prefab({ action: 'modify_asset', asset_path: 'Assets/Prefabs/Enemy.prefab', component_type: 'Transform', properties: { m_LocalScale: [2, 2, 2] } })"
                }, null, 2);
            }
            if (component_type === undefined) {
                return JSON.stringify({
                    error: "component_type is required for 'modify_asset'",
                    hint: "Specify which component on the prefab to modify",
                    example: "unity_prefab({ action: 'modify_asset', asset_path: 'Assets/Prefabs/Enemy.prefab', component_type: 'Transform', properties: { m_LocalScale: [2, 2, 2] } })"
                }, null, 2);
            }
            if (properties === undefined) {
                return JSON.stringify({
                    error: "properties is required for 'modify_asset'",
                    hint: "Use array format for vectors: { m_LocalScale: [2, 2, 2] }",
                    example: "unity_prefab({ action: 'modify_asset', asset_path: 'Assets/Prefabs/Enemy.prefab', component_type: 'Transform', properties: { m_LocalScale: [2, 2, 2] } })"
                }, null, 2);
            }
            result = await callUnityAsync('modify_prefab', {
                assetPath: asset_path,
                componentType: component_type,
                properties
            });
            break;

        case 'apply':
            if (instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'apply'",
                    hint: "First use unity_query({ action: 'hierarchy' }) to find the prefab instance ID in the scene",
                    example: "unity_prefab({ action: 'apply', instance_id: -74268 })"
                }, null, 2);
            }
            result = await callUnityAsync('apply_prefab', { instanceId: instance_id });
            break;

        case 'revert':
            if (instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'revert'",
                    hint: "First use unity_query({ action: 'hierarchy' }) to find the prefab instance ID in the scene",
                    example: "unity_prefab({ action: 'revert', instance_id: -74268 })"
                }, null, 2);
            }
            result = await callUnityAsync('revert_prefab', { instanceId: instance_id });
            break;

        default: {
            const _exhaustive: never = action;
            result = { error: `Unknown action: ${_exhaustive}` };
        }
    }

    return JSON.stringify(result, null, 2);
}

/**
 * The Factory - unity_prefab tool
 * Manage Prefab Assets and Instances.
 */
export const unityPrefab = new DynamicStructuredTool({
    name: 'unity_prefab',
    description: `Manage Prefab Assets and Instances. This is the "Factory".

Actions:
- 'instantiate': Spawn a prefab into the scene by asset path.
- 'instantiate_by_name': Search and spawn by name (easiest way to spawn known assets).
- 'create_asset': Create a new prefab from a scene GameObject.
- 'modify_asset': Edit the .prefab file directly without opening it.
- 'apply': Push scene instance changes back to the prefab asset.
- 'revert': Reset scene instance to match the prefab asset.

Use 'instantiate_by_name' when you know the prefab name but not the exact path.`,
    schema: PrefabSchema,
    func: unityPrefabImpl
});
