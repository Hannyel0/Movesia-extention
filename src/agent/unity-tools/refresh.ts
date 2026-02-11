/**
 * THE COMPILER: unity_refresh
 * "I need to compile my code."
 * Consumes: refresh_assets
 *
 * This tool sends a refresh_assets command to Unity via WebSocket and waits
 * for a compilation_complete response. Unity's CompilationManager handles the
 * async compilation flow (including domain reloads) and sends back the result.
 *
 * The tool uses a dedicated "compilation wait" mechanism on the UnityManager
 * that is NOT cancelled when compilation starts (unlike regular commands).
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { getUnityManager } from './connection';

/**
 * Zod schema for unity_refresh tool input
 */
export const RefreshSchema = z.object({
    watched_scripts: z.array(z.string()).optional()
        .describe("List of specific script names (e.g. ['PlayerController']) to verify existence of after compilation."),

    type_limit: z.number().int().default(20)
        .describe('Limit the number of returned available types to save tokens.')
});

/** Type inferred from the Zod schema */
export type RefreshInput = z.infer<typeof RefreshSchema>;

/** Response structure for successful compilation */
interface CompilationSuccessResponse {
    status: 'SUCCESS';
    message: string;
    verification?: Record<string, boolean>;
    warning?: string;
    next_step?: string;
}

/** Response structure for failed compilation */
interface CompilationFailedResponse {
    status: 'COMPILATION_FAILED';
    message: string;
    errors: string[];
}

/** Response structure for timeout */
interface CompilationTimeoutResponse {
    status: 'TIMEOUT';
    message: string;
    action_required: string;
    common_causes: string[];
}

/** Response structure for not connected */
interface NotConnectedResponse {
    status: 'NOT_CONNECTED';
    message: string;
    hint: string;
}

/** Unity compilation_complete body structure */
interface CompilationCompleteBody {
    success?: boolean;
    recompiled?: boolean;
    hasErrors?: boolean;
    errors?: string[];
    availableTypes?: string[];
    watchedScripts?: {
        found?: string[];
        missing?: string[];
    };
    message?: string;
    error?: string;
}

/**
 * Trigger Unity Asset Database refresh and Script Compilation.
 * This is "The Compiler".
 *
 * CRITICAL: You MUST use this tool after creating or editing C# scripts (.cs files).
 * Unity cannot add a component until the script is compiled.
 */
async function unityRefreshImpl(input: RefreshInput, _config?: any): Promise<string> {
    const { watched_scripts, type_limit = 20 } = input;

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
    // BUILD THE REQUEST
    // ---------------------------------------------------------
    const params: Record<string, unknown> = { typeLimit: type_limit };
    if (watched_scripts) {
        params.watchedScripts = watched_scripts;
    }

    // ---------------------------------------------------------
    // SEND & WAIT (compilation-safe, long timeout)
    // ---------------------------------------------------------
    // Uses sendRefreshAndWait which is NOT cancelled during compilation
    // and has a longer timeout (120s) to survive domain reloads.
    let result: Record<string, unknown>;
    try {
        result = await manager.sendRefreshAndWait('refresh_assets', params);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Handle timeout
        if (errorMessage.toLowerCase().includes('timeout')) {
            const timeoutResponse: CompilationTimeoutResponse = {
                status: 'TIMEOUT',
                message: 'Compilation timed out after 120 seconds. This usually means Unity encountered an issue during domain reload.',
                action_required: "Use unity_query with action: 'get_logs' to check Unity's console for errors or warnings.",
                common_causes: [
                    'Syntax error preventing compilation',
                    'Unity Editor dialog popup blocking (API Updater, etc.)',
                    'Script with infinite loop in static constructor',
                    'Missing assembly reference'
                ]
            };
            return JSON.stringify(timeoutResponse, null, 2);
        }

        // Other errors
        const failedResponse: CompilationFailedResponse = {
            status: 'COMPILATION_FAILED',
            message: `Failed to refresh assets: ${errorMessage}`,
            errors: [errorMessage]
        };
        return JSON.stringify(failedResponse, null, 2);
    }

    // ---------------------------------------------------------
    // SMART RESPONSE PARSING
    // ---------------------------------------------------------
    // The response comes from CompilationManager.cs as compilation_complete
    // Body shape: { success, recompiled, hasErrors, errors, availableTypes, watchedScripts: { found, missing } }
    const body = result as CompilationCompleteBody;
    const success = body.success !== false; // Default to true if not explicitly false

    // Case 1: Compilation Failed
    if (!success || body.hasErrors) {
        const errors = body.errors ?? [];
        const failedResponse: CompilationFailedResponse = {
            status: 'COMPILATION_FAILED',
            message: 'Unity failed to compile the scripts. You must fix these errors:',
            errors
        };
        return JSON.stringify(failedResponse, null, 2);
    }

    // Case 2: Success
    const response: CompilationSuccessResponse = {
        status: 'SUCCESS',
        message: body.recompiled
            ? 'Assets refreshed and scripts compiled successfully.'
            : 'Assets refreshed. No script changes detected (no recompilation needed).'
    };

    // Did we find the scripts the agent cared about?
    if (watched_scripts && body.watchedScripts) {
        const missingScripts = body.watchedScripts.missing ?? [];
        const foundScripts = body.watchedScripts.found ?? [];

        // Build verification map
        const verification: Record<string, boolean> = {};
        for (const name of foundScripts) {
            verification[name] = true;
        }
        for (const name of missingScripts) {
            verification[name] = false;
        }
        response.verification = verification;

        if (missingScripts.length > 0) {
            response.warning = `Compilation passed, but these types are still missing: ${JSON.stringify(missingScripts)}. Did you get the class name right inside the file?`;
        } else if (foundScripts.length > 0) {
            response.next_step = "You can now use unity_component({ action: 'add' }) with these scripts.";
        }
    }

    return JSON.stringify(response, null, 2);
}

/**
 * The Compiler - unity_refresh tool
 * Trigger Unity Asset Database refresh and Script Compilation.
 *
 * Sends refresh_assets to Unity and waits for compilation_complete response.
 * Uses a compilation-safe wait mechanism that survives domain reloads.
 */
export const unityRefresh = new DynamicStructuredTool({
    name: 'unity_refresh',
    description: `Trigger Unity Asset Database refresh and Script Compilation. This is "The Compiler".

CRITICAL: You MUST use this tool after creating or editing C# scripts (.cs files).
Unity cannot add a component until the script is compiled.

Behavior:
1. Sends refresh command to Unity and waits for compilation to finish.
2. Returns 'COMPILATION_FAILED' with errors if syntax errors exist.
3. Confirms if 'watched_scripts' are now valid components.`,
    schema: RefreshSchema,
    func: unityRefreshImpl
});
