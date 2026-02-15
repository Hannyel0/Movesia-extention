/**
 * Unity Tools Package - The 7 Tools for Unity Editor manipulation.
 *
 * This package provides a clean interface for AI agents to interact with the Unity Editor
 * through WebSocket communication via the UnityManager.
 *
 * Tools:
 * - unity_query: The Observer - read-only inspection
 * - unity_hierarchy: The Architect - scene graph structure
 * - unity_component: The Engineer - behavior and data
 * - unity_prefab: The Factory - templates and instances
 * - unity_scene: The Director - environment management
 * - unity_refresh: The Compiler - script compilation
 * - unity_deletion: The Janitor - asset deletion (moves to OS trash)
 *
 * Setup:
 *     Before using tools, register the Unity manager:
 *
 *         import { setUnityManager } from './unity-tools';
 *         setUnityManager(unityManager);
 */

// Connection utilities
export { callUnityAsync, setUnityManager, getUnityManager } from './connection';

// Types
export type { UnityManager, UnityResponse, ToolErrorResponse, Vector3 } from './types';

// Individual tools with their schemas and types
export { unityQuery, QuerySchema, type QueryInput } from './query';
export { unityHierarchy, HierarchySchema, type HierarchyInput } from './hierarchy';
export { unityComponent, ComponentSchema, type ComponentInput } from './component';
export { unityPrefab, PrefabSchema, type PrefabInput } from './prefab';
export { unityScene, SceneSchema, type SceneInput } from './scene';
export { unityRefresh, RefreshSchema, type RefreshInput } from './refresh';
export { unityDeletion, DeletionSchema, type DeletionInput } from './deletion';

// Import tools for the array export
import { unityQuery } from './query';
import { unityHierarchy } from './hierarchy';
import { unityComponent } from './component';
import { unityPrefab } from './prefab';
import { unityScene } from './scene';
import { unityRefresh } from './refresh';
import { unityDeletion } from './deletion';

/**
 * The 7 Unity Tools as an array for easy registration with LangGraph.
 *
 * Usage:
 *     import { unityTools } from './unity-tools';
 *     const agent = createReactAgent({ tools: unityTools });
 */
export const unityTools = [
    unityQuery,      // The Observer - read-only inspection
    unityHierarchy,  // The Architect - scene graph structure
    unityComponent,  // The Engineer - behavior and data
    unityPrefab,     // The Factory - templates and instances
    unityScene,      // The Director - environment management
    unityRefresh,    // The Compiler - script compilation
    unityDeletion,   // The Janitor - asset deletion
] as const;

/** Type for any Unity tool */
export type UnityTool = typeof unityTools[number];
