/**
 * THE ENGINEER: unity_component
 * "I need to change behavior and data."
 * Consumes: add_component, remove_component, modify_component
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { callUnityAsync } from './connection';

/**
 * Zod schema for unity_component tool input
 */
export const ComponentSchema = z.object({
    action: z.enum(['add', 'remove', 'modify'])
        .describe('The component operation.'),

    // Target identifiers - two ways to target a component
    game_object_id: z.number().int().optional()
        .describe("GameObject instance ID. Required for 'add'. For 'modify'/'remove', use with component_type as alternative to component_id."),

    component_type: z.string().optional()
        .describe("Component type name (e.g., 'Transform', 'Rigidbody', 'BoxCollider'). Required for 'add'. For 'modify'/'remove', use with game_object_id."),

    component_id: z.number().int().optional()
        .describe("Direct component instance ID. Alternative to game_object_id + component_type for 'modify'/'remove'."),

    component_index: z.number().int().default(0)
        .describe('Index when multiple components of same type exist (default: 0 = first).'),

    // Properties for modify
    properties: z.record(z.string(), z.unknown()).optional()
        .describe("Properties to modify. Use array format for vectors: { m_LocalPosition: [0, 5, 0] }")
});

/** Type inferred from the Zod schema */
export type ComponentInput = z.infer<typeof ComponentSchema>;

/**
 * Edit components on GameObjects. This is the "Engineer".
 */
async function unityComponentImpl(input: ComponentInput, _config?: any): Promise<string> {
    const {
        action,
        game_object_id,
        component_type,
        component_id,
        component_index = 0,
        properties
    } = input;

    let result;

    switch (action) {
        case 'add':
            if (game_object_id === undefined) {
                return JSON.stringify({
                    error: "game_object_id is required for 'add'",
                    hint: "First use unity_query(action='hierarchy') to find the GameObject ID",
                    example: "unity_component({ action: 'add', game_object_id: -74268, component_type: 'Rigidbody' })"
                }, null, 2);
            }
            if (component_type === undefined) {
                return JSON.stringify({
                    error: "component_type is required for 'add'",
                    hint: "Specify the component type to add (e.g., Rigidbody, BoxCollider, AudioSource)",
                    example: "unity_component({ action: 'add', game_object_id: -74268, component_type: 'Rigidbody' })"
                }, null, 2);
            }
            result = await callUnityAsync('add_component', {
                instanceId: game_object_id,
                componentType: component_type
            });
            break;

        case 'modify':
            if (properties === undefined) {
                return JSON.stringify({
                    error: "properties is required for 'modify'",
                    hint: "Use array format for vectors: { m_LocalPosition: [0, 5, 0] }",
                    example: "unity_component({ action: 'modify', game_object_id: -74268, component_type: 'Transform', properties: { m_LocalPosition: [0, 5, 0] } })"
                }, null, 2);
            }

            const modifyParams: Record<string, unknown> = { properties };

            if (component_id !== undefined) {
                // Direct component ID
                modifyParams.componentInstanceId = component_id;
            } else if (game_object_id !== undefined && component_type !== undefined) {
                // GameObject + type (agent-friendly!)
                modifyParams.gameObjectInstanceId = game_object_id;
                modifyParams.componentType = component_type;
                modifyParams.componentIndex = component_index;
            } else {
                return JSON.stringify({
                    error: "For 'modify', provide EITHER component_id OR (game_object_id + component_type)",
                    hint: "Easiest: use game_object_id + component_type, e.g., game_object_id: -74268, component_type: 'Transform'"
                }, null, 2);
            }

            result = await callUnityAsync('modify_component', modifyParams);
            break;

        case 'remove':
            if (component_id !== undefined) {
                result = await callUnityAsync('remove_component', {
                    componentInstanceId: component_id
                });
            } else if (game_object_id !== undefined && component_type !== undefined) {
                result = await callUnityAsync('remove_component', {
                    gameObjectInstanceId: game_object_id,
                    componentType: component_type,
                    componentIndex: component_index
                });
            } else {
                return JSON.stringify({
                    error: "For 'remove', provide EITHER component_id OR (game_object_id + component_type)",
                    hint: "Easiest: use game_object_id + component_type from the hierarchy",
                    example: "unity_component({ action: 'remove', game_object_id: -74268, component_type: 'Rigidbody' })"
                }, null, 2);
            }
            break;

        default: {
            const _exhaustive: never = action;
            result = { error: `Unknown action: ${_exhaustive}` };
        }
    }

    return JSON.stringify(result, null, 2);
}

/**
 * The Engineer - unity_component tool
 * Edit components on GameObjects.
 */
export const unityComponent = new DynamicStructuredTool({
    name: 'unity_component',
    description: `Edit components on GameObjects. This is the "Engineer".

Actions:
- 'add': Attach a component. Requires game_object_id + component_type.
- 'modify': Change properties. Use EITHER component_id OR (game_object_id + component_type).
- 'remove': Delete a component. Use EITHER component_id OR (game_object_id + component_type).

RECOMMENDED WORKFLOW FOR MODIFY:
Just use game_object_id + component_type - no need to inspect first!
Example: unity_component({ action: 'modify', game_object_id: -74268, component_type: 'Transform',
                          properties: { m_LocalPosition: [0, 5, 0] } })

PROPERTY FORMAT:
- Vectors use ARRAYS: { m_LocalPosition: [0, 5, 0] } ✓
- NOT objects: { m_LocalPosition: { x: 0 } } ✗

Common types: Transform, Rigidbody, BoxCollider, SphereCollider, MeshRenderer, AudioSource, Light, Camera`,
    schema: ComponentSchema,
    func: unityComponentImpl
});
