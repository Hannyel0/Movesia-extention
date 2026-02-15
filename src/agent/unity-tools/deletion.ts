/**
 * THE JANITOR: unity_deletion
 * "I need to remove assets from the project."
 * Consumes: delete_assets
 *
 * Moves assets to the OS trash (recycle bin) for safe, recoverable deletion.
 * Supports batch deletion of multiple assets in a single call.
 *
 * When deleting .cs/.asmdef files, Unity triggers a domain reload which
 * disconnects the WebSocket. The C# DeletionManager defers the response
 * until after reload and reconnection. This tool uses sendRefreshAndWait()
 * (the compilation-safe queue) so the pending promise survives the disconnect.
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { getUnityManager } from './connection';

/**
 * Zod schema for unity_deletion tool input
 */
export const DeletionSchema = z.object({
    paths: z.array(z.string()).min(1)
        .describe('Array of asset paths to delete (e.g., ["Assets/Scripts/Old.cs", "Assets/Materials/Unused.mat"]). Paths should start with "Assets/" or be relative to it.'),
});

/** Type inferred from the Zod schema */
export type DeletionInput = z.infer<typeof DeletionSchema>;

/** Unity DeletionResult body structure */
interface DeletionResultBody {
    success?: boolean;
    error?: string;
    requestedCount?: number;
    deletedCount?: number;
    failedCount?: number;
    deletedPaths?: string[];
    failedPaths?: string[];
    triggeredRecompile?: boolean;
}

/** Response for successful deletion */
interface DeletionSuccessResponse {
    status: 'SUCCESS';
    message: string;
    deletedCount: number;
    failedCount: number;
    deletedPaths: string[];
    failedPaths: string[];
    triggeredRecompile: boolean;
}

/** Response for failed deletion */
interface DeletionFailedResponse {
    status: 'FAILED';
    message: string;
    error: string;
    failedPaths: string[];
}

/** Response for timeout */
interface DeletionTimeoutResponse {
    status: 'TIMEOUT';
    message: string;
    hint: string;
}

/** Response for not connected */
interface NotConnectedResponse {
    status: 'NOT_CONNECTED';
    message: string;
    hint: string;
}

/**
 * Delete assets from the Unity project by moving them to the OS trash.
 * Uses sendRefreshAndWait() to survive domain reloads when deleting scripts.
 */
async function unityDeletionImpl(input: DeletionInput, _config?: any): Promise<string> {
    const { paths } = input;

    // ---------------------------------------------------------
    // CHECK CONNECTION
    // ---------------------------------------------------------
    const manager = getUnityManager();
    if (!manager) {
        const response: NotConnectedResponse = {
            status: 'NOT_CONNECTED',
            message: 'Unity manager not initialized.',
            hint: 'Make sure the extension is fully initialized and a project is selected.'
        };
        return JSON.stringify(response, null, 2);
    }

    if (!manager.isConnected) {
        const response: NotConnectedResponse = {
            status: 'NOT_CONNECTED',
            message: 'Unity is not connected.',
            hint: 'Ensure Unity Editor is running with the Movesia package installed and the WebSocket connection is established.'
        };
        return JSON.stringify(response, null, 2);
    }

    // ---------------------------------------------------------
    // SEND & WAIT (compilation-safe, long timeout)
    // ---------------------------------------------------------
    // Uses sendRefreshAndWait which is NOT cancelled during compilation
    // and has a longer timeout (120s) to survive domain reloads.
    // This is critical when deleting .cs/.asmdef files.
    let result: Record<string, unknown>;
    try {
        result = await manager.sendRefreshAndWait('delete_assets', { paths });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.toLowerCase().includes('timeout')) {
            const timeoutResponse: DeletionTimeoutResponse = {
                status: 'TIMEOUT',
                message: 'Deletion timed out after 120 seconds. Unity may be stuck during domain reload.',
                hint: "Use unity_query with action: 'get_logs' to check Unity's console for errors."
            };
            return JSON.stringify(timeoutResponse, null, 2);
        }

        const failedResponse: DeletionFailedResponse = {
            status: 'FAILED',
            message: `Deletion failed: ${errorMessage}`,
            error: errorMessage,
            failedPaths: paths
        };
        return JSON.stringify(failedResponse, null, 2);
    }

    // ---------------------------------------------------------
    // PARSE RESPONSE
    // ---------------------------------------------------------
    const body = result as DeletionResultBody;

    if (!body.success) {
        const failedResponse: DeletionFailedResponse = {
            status: 'FAILED',
            message: body.error ?? 'Deletion failed with unknown error.',
            error: body.error ?? 'Unknown error',
            failedPaths: body.failedPaths ?? []
        };
        return JSON.stringify(failedResponse, null, 2);
    }

    const response: DeletionSuccessResponse = {
        status: 'SUCCESS',
        message: body.deletedCount === 1
            ? `Deleted 1 asset successfully.`
            : `Deleted ${body.deletedCount} assets successfully.`,
        deletedCount: body.deletedCount ?? 0,
        failedCount: body.failedCount ?? 0,
        deletedPaths: body.deletedPaths ?? [],
        failedPaths: body.failedPaths ?? [],
        triggeredRecompile: body.triggeredRecompile ?? false
    };

    if (body.failedCount && body.failedCount > 0) {
        response.message += ` ${body.failedCount} asset(s) failed to delete.`;
    }

    if (body.triggeredRecompile) {
        response.message += ' Domain reload was triggered (scripts were deleted).';
    }

    return JSON.stringify(response, null, 2);
}

/**
 * The Janitor - unity_deletion tool
 * Delete assets from the Unity project.
 *
 * Uses compilation-safe WebSocket queue to survive domain reloads
 * when deleting scripts (.cs) or assembly definitions (.asmdef).
 */
export const unityDeletion = new DynamicStructuredTool({
    name: 'unity_deletion',
    description: `Delete assets from the Unity project by moving them to the OS trash (recycle bin). Deletion is recoverable.

Accepts an array of asset paths. Paths should start with "Assets/" (e.g., "Assets/Scripts/OldScript.cs"). If omitted, "Assets/" is auto-prepended.

Use unity_query(action='search_assets') first to find asset paths before deleting.

Handles domain reloads automatically when deleting scripts (.cs) or assembly definitions (.asmdef).

Returns: deletedCount, failedCount, deletedPaths, and failedPaths for full visibility.`,
    schema: DeletionSchema,
    func: unityDeletionImpl
});
