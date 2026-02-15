/**
 * Shared connection utilities for Unity WebSocket communication.
 *
 * This module provides the async bridge between LangGraph tools and the Unity WebSocket connection.
 * Tools call `callUnityAsync()` which routes through the UnityManager's WebSocket.
 */

import type { UnityManager, UnityResponse } from './types';

/** Global reference to unity_manager - set during server startup */
let unityManager: UnityManager | null = null;

/**
 * Set the global unity manager reference.
 * Called from server.ts during startup.
 */
export function setUnityManager(manager: UnityManager): void {
    unityManager = manager;
}

/**
 * Get the global unity manager instance.
 */
export function getUnityManager(): UnityManager | null {
    return unityManager;
}

/**
 * Send a request to Unity via WebSocket and wait for response.
 *
 * @param action - The Unity command type (e.g., 'get_hierarchy', 'create_gameobject')
 * @param params - Command parameters
 * @returns Response from Unity
 * @throws Error if Unity manager not initialized
 */
export async function callUnityAsync(
    action: string,
    params: Record<string, unknown> = {}
): Promise<UnityResponse> {
    console.log(`[Unity Tool] 🔍 [DEBUG] callUnityAsync("${action}") called`);
    console.log(`[Unity Tool] 🔍 [DEBUG] unityManager is ${unityManager === null ? '❌ NULL' : 'SET'}`);

    if (unityManager === null) {
        console.error('[Unity Tool] 🔍 [DEBUG] ❌ Unity manager is NULL — setUnityManager() was never called or failed');
        throw new Error('Unity manager not initialized. Tools cannot communicate with Unity.');
    }

    const mgr = unityManager as any;
    console.log(`[Unity Tool] 🔍 [DEBUG] unityManager.isConnected=${unityManager.isConnected}, targetProjectPath="${mgr._targetProjectPath || 'NOT SET'}", connectionCount=${mgr.connectionCount ?? 'N/A'}`);

    if (!unityManager.isConnected) {
        const targetPath = mgr._targetProjectPath;
        console.warn(`[Unity Tool] 🔍 [DEBUG] ❌ Unity NOT connected. Reasons could be:`);
        if (!targetPath) {
            console.warn(`[Unity Tool] 🔍 [DEBUG]   - _targetProjectPath is NOT SET (setTargetProject was never called)`);
        } else {
            console.warn(`[Unity Tool] 🔍 [DEBUG]   - _targetProjectPath="${targetPath}" but no matching Unity connection found`);
            console.warn(`[Unity Tool] 🔍 [DEBUG]   - Total connections: ${mgr.connectionCount ?? 'N/A'}`);
        }
        return {
            success: false,
            error: 'Unity is not connected. Please ensure Unity Editor is running and connected.',
            hint: 'Check that the Movesia plugin is installed in Unity and the WebSocket connection is established.'
        };
    }

    try {
        console.log(`[Unity Tool] Sending command to Unity: ${action}`);
        const result = await unityManager.sendAndWait(action, params);
        console.log(`[Unity Tool] Received response for: ${action}`, { success: (result as any)?.success });
        // The UnityManager returns the message body which should have success/error fields
        // Cast to UnityResponse - Unity's plugin should always include these fields
        return result as unknown as UnityResponse;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.toLowerCase().includes('timeout')) {
            console.warn(`[Unity Tool] Command timed out: ${action}`);
            return {
                success: false,
                error: `Command timed out: ${action}`,
                hint: 'Unity may be busy (compiling, showing a dialog, etc.). Try again.'
            };
        }

        console.error(`[Unity Tool] Command failed: ${action} - ${errorMessage}`);
        return {
            success: false,
            error: errorMessage
        };
    }
}
