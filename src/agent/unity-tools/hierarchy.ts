/**
 * THE ARCHITECT: unity_hierarchy
 * "I need to organize the Scene Graph."
 * Consumes: create_gameobject, duplicate_gameobject, destroy_gameobject,
 *           rename_gameobject, set_parent, move_to_scene
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { callUnityAsync } from './connection';

/**
 * Zod schema for unity_hierarchy tool input
 */
export const HierarchySchema = z.object({
    action: z.enum(['create', 'duplicate', 'destroy', 'rename', 'reparent', 'move_scene'])
        .describe('The hierarchy manipulation action.'),

    // Target
    instance_id: z.number().int().optional()
        .describe('The object to manipulate.'),

    // Create params
    name: z.string().optional()
        .describe('New name (for create/rename).'),
    primitive_type: z.string().optional()
        .describe("Optional primitive (Cube, Sphere, Capsule, Cylinder, Plane, Quad) for 'create'."),

    // Positioning
    parent_id: z.number().int().optional()
        .describe('Parent ID for create/reparent.'),
    position: z.tuple([z.number(), z.number(), z.number()]).optional()
        .describe('[x, y, z] for creation.'),
    target_scene: z.string().optional()
        .describe("Scene name for 'move_scene'.")
});

/** Type inferred from the Zod schema */
export type HierarchyInput = z.infer<typeof HierarchySchema>;

/** Map tool actions to Unity WebSocket action names */
const API_MAP = {
    create: 'create_gameobject',
    duplicate: 'duplicate_gameobject',
    destroy: 'destroy_gameobject',
    rename: 'rename_gameobject',
    reparent: 'set_parent',
    move_scene: 'move_to_scene'
} as const;

/**
 * Manage GameObject structure in the scene hierarchy. This is the "Architect".
 */
async function unityHierarchyImpl(input: HierarchyInput, _config?: any): Promise<string> {
    const {
        action,
        instance_id,
        name,
        primitive_type,
        parent_id,
        position,
        target_scene
    } = input;

    const params: Record<string, unknown> = {};

    switch (action) {
        case 'create':
            if (name) params.name = name;
            if (primitive_type) params.primitive = primitive_type;
            if (parent_id !== undefined) params.parentInstanceId = parent_id;
            if (position) params.position = position;
            break;

        case 'duplicate':
            if (instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'duplicate'",
                    hint: "First use unity_query(action='hierarchy') to find the GameObject ID",
                    example: "unity_hierarchy({ action: 'duplicate', instance_id: -74268 })"
                }, null, 2);
            }
            params.instanceId = instance_id;
            break;

        case 'destroy':
            if (instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'destroy'",
                    hint: "First use unity_query(action='hierarchy') to find the GameObject ID",
                    example: "unity_hierarchy({ action: 'destroy', instance_id: -74268 })"
                }, null, 2);
            }
            params.instanceId = instance_id;
            break;

        case 'rename':
            if (instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'rename'",
                    hint: "First use unity_query(action='hierarchy') to find the GameObject ID",
                    example: "unity_hierarchy({ action: 'rename', instance_id: -74268, name: 'NewName' })"
                }, null, 2);
            }
            if (name === undefined) {
                return JSON.stringify({
                    error: "name is required for 'rename'",
                    hint: "Provide the new name for the GameObject",
                    example: "unity_hierarchy({ action: 'rename', instance_id: -74268, name: 'Player' })"
                }, null, 2);
            }
            params.instanceId = instance_id;
            params.name = name;
            break;

        case 'reparent':
            if (instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'reparent'",
                    hint: "First use unity_query(action='hierarchy') to find both object IDs",
                    example: "unity_hierarchy({ action: 'reparent', instance_id: -74268, parent_id: -12345 })"
                }, null, 2);
            }
            params.instanceId = instance_id;
            params.parentInstanceId = parent_id; // undefined means move to root
            break;

        case 'move_scene':
            if (instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'move_scene'",
                    hint: "First use unity_query(action='hierarchy') to find the GameObject ID",
                    example: "unity_hierarchy({ action: 'move_scene', instance_id: -74268, target_scene: 'Level2' })"
                }, null, 2);
            }
            if (target_scene === undefined) {
                return JSON.stringify({
                    error: "target_scene is required for 'move_scene'",
                    hint: "Provide the name of the destination scene",
                    example: "unity_hierarchy({ action: 'move_scene', instance_id: -74268, target_scene: 'Level2' })"
                }, null, 2);
            }
            params.instanceId = instance_id;
            params.sceneName = target_scene;
            break;

        default: {
            const _exhaustive: never = action;
            return JSON.stringify({ error: `Unknown action: ${_exhaustive}` }, null, 2);
        }
    }

    const result = await callUnityAsync(API_MAP[action], params);
    return JSON.stringify(result, null, 2);
}

/**
 * The Architect - unity_hierarchy tool
 * Manage GameObject structure in the scene hierarchy.
 */
export const unityHierarchy = new DynamicStructuredTool({
    name: 'unity_hierarchy',
    description: `Manage GameObject structure in the scene hierarchy. This is the "Architect".

Actions:
- 'create': Make new empty objects or primitives (Cube, Sphere, etc.).
- 'duplicate': Clone an existing GameObject.
- 'destroy': Remove objects (Undo supported).
- 'rename': Change a GameObject's name.
- 'reparent': Move objects in the hierarchy tree.
- 'move_scene': Move root objects between loaded scenes.`,
    schema: HierarchySchema,
    func: unityHierarchyImpl
});
