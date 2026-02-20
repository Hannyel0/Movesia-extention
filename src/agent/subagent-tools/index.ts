/**
 * Subagent Tools Package - Tools used exclusively by subagents.
 *
 * These tools are NOT included in the main agent's tool list.
 * They are only available to specialized subagents.
 *
 * Tools:
 * - unity_probuilder: The Sculptor - ProBuilder mesh creation and editing
 * - unity_spatial: The Surveyor - spatial context and alignment checks
 * - unity_screenshot: The Observer's Eye - visual feedback (detached for now)
 */

// Export individual tools with their schemas and types
export { unityProBuilder, ProBuilderSchema, type ProBuilderInput } from './probuilder';
export { unitySpatial, SpatialSchema, type SpatialInput } from './spatial';
export { unityScreenshot, ScreenshotSchema, type ScreenshotInput } from './screenshot';

// Import tools for the array export
import { unityProBuilder } from './probuilder';
import { unitySpatial } from './spatial';
// Note: unityScreenshot is exported but not included in tool arrays (detached for now)

// Import material tool from unity-tools for the probuilder subagent
import { unityMaterial } from '../unity-tools/material';

/**
 * ProBuilder subagent tools - includes ProBuilder, Material, and Spatial tools.
 * Material tool is included for advanced face-level material assignment.
 * Spatial tool is included for verifying object positions and alignments.
 */
export const probuilderTools = [
    unityProBuilder,  // The Sculptor - ProBuilder mesh editing
    unityMaterial,    // The Artist - for standalone material creation/assignment
    unitySpatial,     // The Surveyor - spatial context and alignment checks
] as const;

/** Type for ProBuilder subagent tools */
export type ProBuilderTool = typeof probuilderTools[number];
