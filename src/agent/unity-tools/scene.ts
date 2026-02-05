/**
 * THE DIRECTOR: unity_scene
 * "I need to change the environment."
 * Consumes: create_scene, open_scene, save_scene, set_active_scene
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { callUnityAsync } from './connection';

/**
 * Zod schema for unity_scene tool input
 */
export const SceneSchema = z.object({
    action: z.enum(['open', 'save', 'create', 'set_active'])
        .describe('The scene operation.'),

    path: z.string().optional()
        .describe('File path (Assets/Scenes/MyScene.unity).'),

    additive: z.boolean().default(false)
        .describe('Open/Create additively (keep current scene loaded)?')
});

/** Type inferred from the Zod schema */
export type SceneInput = z.infer<typeof SceneSchema>;

/**
 * Manage Scene files. This is the "Director".
 */
async function unitySceneImpl(input: SceneInput, _config?: any): Promise<string> {
    const {
        action,
        path,
        additive = false
    } = input;

    let result;

    switch (action) {
        case 'open':
            if (path === undefined) {
                return JSON.stringify({
                    error: "path is required for 'open'",
                    hint: "Provide the scene file path (relative to Assets folder)",
                    example: "unity_scene({ action: 'open', path: 'Assets/Scenes/Level2.unity' })"
                }, null, 2);
            }
            result = await callUnityAsync('open_scene', { path, additive });
            break;

        case 'save':
            {
                const params: Record<string, unknown> = {};
                if (path) params.path = path;
                result = await callUnityAsync('save_scene', params);
            }
            break;

        case 'create':
            if (path === undefined) {
                return JSON.stringify({
                    error: "path is required for 'create'",
                    hint: "Provide the path for the new scene file (must end with .unity)",
                    example: "unity_scene({ action: 'create', path: 'Assets/Scenes/NewLevel.unity' })"
                }, null, 2);
            }
            result = await callUnityAsync('create_scene', { savePath: path, additive });
            break;

        case 'set_active':
            if (path === undefined) {
                return JSON.stringify({
                    error: "path is required for 'set_active'",
                    hint: "The scene must already be loaded (use additive: true when opening)",
                    example: "unity_scene({ action: 'set_active', path: 'Assets/Scenes/Level2.unity' })"
                }, null, 2);
            }
            result = await callUnityAsync('set_active_scene', { path });
            break;

        default: {
            const _exhaustive: never = action;
            result = { error: `Unknown action: ${_exhaustive}` };
        }
    }

    return JSON.stringify(result, null, 2);
}

/**
 * The Director - unity_scene tool
 * Manage Scene files.
 */
export const unityScene = new DynamicStructuredTool({
    name: 'unity_scene',
    description: `Manage Scene files. This is the "Director".

Actions:
- 'open': Load a scene (use additive: true to keep current scene).
- 'save': Save the current scene (optionally to a new path).
- 'create': Create a new scene file.
- 'set_active': Set which loaded scene is the active scene.

IMPORTANT: Always save before opening a new scene to avoid losing changes.`,
    schema: SceneSchema,
    func: unitySceneImpl
});
