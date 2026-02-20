/**
 * THE SURVEYOR: unity_spatial
 * "I need to verify object positions and check alignments."
 * Consumes: get_spatial_context (unified endpoint)
 *
 * This tool gives the agent "computed vision" — world-space positions, bounds,
 * and automatic alignment checks for objects in the scene.
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { callUnityAsync } from '../unity-tools/connection';

/**
 * Zod schema for unity_spatial tool input
 */
export const SpatialSchema = z.object({
    // Focused mode parameters (recommended)
    names: z.array(z.string()).optional()
        .describe("Find objects by name (case-insensitive substring match). Use for focused queries."),
    instance_ids: z.array(z.number().int()).optional()
        .describe("Find objects by Unity instanceId. Use IDs from previous create/modify responses."),
    max_distance: z.number().optional().default(0.5)
        .describe("How far (meters) to search for nearby neighbors. Also used as tolerance for alignment checks. Default: 0.5"),

    // Full scene mode parameters
    max_objects: z.number().int().optional().default(200)
        .describe("Max objects to return in full scene mode. Default: 200"),
    name_pattern: z.string().optional()
        .describe("Substring filter on object names (full scene mode only)"),
    tag_filter: z.string().optional()
        .describe("Exact tag match filter (full scene mode only)"),
    include_inactive: z.boolean().optional().default(false)
        .describe("Include inactive GameObjects (full scene mode only)"),

    // Shared parameters
    include_alignment_checks: z.boolean().optional().default(true)
        .describe("Generate alignment check strings. Default: true"),
    include_components: z.boolean().optional().default(false)
        .describe("Include component names array per object. Default: false"),
    min_bounds_size: z.number().optional().default(0.1)
        .describe("Min bounds magnitude for alignment checks. Default: 0.1")
});

/** Type inferred from the Zod schema */
export type SpatialInput = z.infer<typeof SpatialSchema>;

/**
 * Get spatial context for objects in the scene.
 * Returns positions, bounds, and alignment checks.
 */
async function unitySpatialImpl(input: SpatialInput): Promise<string> {
    console.log(`[unity_spatial] Getting spatial context`);

    // Build request body
    const body: Record<string, unknown> = {};

    // Focused mode parameters
    if (input.names && input.names.length > 0) {
        body.names = input.names;
        console.log(`[unity_spatial]   Names: ${input.names.join(', ')}`);
    }
    if (input.instance_ids && input.instance_ids.length > 0) {
        body.instanceIds = input.instance_ids;
        console.log(`[unity_spatial]   InstanceIds: ${input.instance_ids.join(', ')}`);
    }
    if (input.max_distance !== undefined && input.max_distance !== 0.5) {
        body.maxDistance = input.max_distance;
    }

    // Full scene mode parameters (only if not in focused mode)
    const isFocusedMode = (input.names && input.names.length > 0) ||
                          (input.instance_ids && input.instance_ids.length > 0);

    if (!isFocusedMode) {
        console.log(`[unity_spatial]   Mode: Full scene`);
        if (input.max_objects !== undefined && input.max_objects !== 200) {
            body.maxObjects = input.max_objects;
        }
        if (input.name_pattern) {
            body.namePattern = input.name_pattern;
        }
        if (input.tag_filter) {
            body.tagFilter = input.tag_filter;
        }
        if (input.include_inactive) {
            body.includeInactive = input.include_inactive;
        }
    } else {
        console.log(`[unity_spatial]   Mode: Focused`);
    }

    // Shared parameters
    if (input.include_alignment_checks === false) {
        body.includeAlignmentChecks = false;
    }
    if (input.include_components) {
        body.includeComponents = true;
    }
    if (input.min_bounds_size !== undefined && input.min_bounds_size !== 0.1) {
        body.minBoundsSize = input.min_bounds_size;
    }

    const result = await callUnityAsync('get_spatial_context', body);

    // Log summary for debugging
    if ((result as any).success) {
        const response = result as any;
        console.log(`[unity_spatial] ✅ Got ${response.objectCount} objects, ${response.proBuilderCount} ProBuilder`);
        if (response.alignmentChecks && response.alignmentChecks.length > 0) {
            console.log(`[unity_spatial]   Alignment checks: ${response.alignmentChecks.length}`);
        }
        if (response.truncated) {
            console.log(`[unity_spatial]   ⚠️ Results truncated (hit maxObjects limit)`);
        }
    } else {
        console.log(`[unity_spatial] ❌ Failed:`, JSON.stringify(result, null, 2));
    }

    return JSON.stringify(result, null, 2);
}

/**
 * The Surveyor - unity_spatial tool
 * Get spatial context and alignment checks for objects in the scene.
 */
export const unitySpatial = new DynamicStructuredTool({
    name: 'unity_spatial',
    description: `Verify object positions and alignments after creating geometry. Returns bounds and alignment checks (✅/⚠️).`,
    schema: SpatialSchema,
    func: unitySpatialImpl
});
