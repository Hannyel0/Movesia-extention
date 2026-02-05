/**
 * THE OBSERVER: unity_query
 * "I need to see what exists."
 * Consumes: get_hierarchy, get_components, get_project_settings, get_logs, search_assets
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { callUnityAsync } from './connection';

/**
 * Zod schema for unity_query tool input
 */
export const QuerySchema = z.object({
    action: z.enum(['hierarchy', 'inspect_object', 'search_assets', 'get_logs', 'get_settings'])
        .describe('The query type.'),

    // Hierarchy params
    max_depth: z.number().int().default(5)
        .describe('Depth for hierarchy traversal.'),

    // Inspect params
    instance_id: z.number().int().optional()
        .describe("Required for 'inspect_object'. The GameObject Instance ID."),

    // Search params
    search_query: z.string().optional()
        .describe("Name/Label filter for 'search_assets'."),
    asset_type: z.string().optional()
        .describe("Type filter (e.g., 'prefab', 'script') for 'search_assets'."),

    // Log params
    log_filter: z.string().optional()
        .describe("'Error', 'Warning', or 'Exception'."),

    // Settings params
    settings_category: z.string().optional()
        .describe("Settings category (e.g., 'physics', 'player', 'quality').")
});

/** Type inferred from the Zod schema */
export type QueryInput = z.infer<typeof QuerySchema>;

/**
 * Read the current state of the Unity Editor. This is the agent's "eyes".
 */
async function unityQueryImpl(input: QueryInput, _config?: any): Promise<string> {
    const {
        action,
        max_depth = 5,
        instance_id,
        search_query,
        asset_type,
        log_filter,
        settings_category
    } = input;

    let result;

    switch (action) {
        case 'hierarchy':
            result = await callUnityAsync('get_hierarchy', { maxDepth: max_depth });
            break;

        case 'inspect_object':
            if (instance_id === undefined) {
                return JSON.stringify({
                    error: "instance_id is required for 'inspect_object'",
                    hint: "First use unity_query(action='hierarchy') to find GameObject IDs",
                    example: "unity_query({ action: 'inspect_object', instance_id: -74268 })"
                }, null, 2);
            }
            result = await callUnityAsync('get_components', { instanceId: instance_id });
            break;

        case 'search_assets':
            result = await callUnityAsync('search_assets', {
                name: search_query,
                type: asset_type
            });
            break;

        case 'get_logs':
            result = await callUnityAsync('get_logs', { filter: log_filter });
            break;

        case 'get_settings':
            result = await callUnityAsync('get_project_settings', { category: settings_category });
            break;

        default: {
            // TypeScript exhaustiveness check
            const _exhaustive: never = action;
            result = { error: `Unknown action: ${_exhaustive}` };
        }
    }

    return JSON.stringify(result, null, 2);
}

/**
 * The Observer - unity_query tool
 * Read the current state of the Unity Editor.
 */
export const unityQuery = new DynamicStructuredTool({
    name: 'unity_query',
    description: `Read the current state of the Unity Editor. This is the agent's "eyes".

Actions:
- 'hierarchy': See the scene tree structure.
- 'inspect_object': Get components and properties of a specific object (Requires instance_id).
- 'search_assets': Find prefabs, scripts, or assets in the project folders.
- 'get_settings': Retrieve specific project settings.
- 'get_logs': Check console for errors, warnings, or logs.`,
    schema: QuerySchema,
    func: unityQueryImpl
});
