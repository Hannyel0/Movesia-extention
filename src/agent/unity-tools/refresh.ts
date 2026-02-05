/**
 * THE COMPILER: unity_refresh
 * "I need to compile my code."
 * Consumes: refresh_assets
 *
 * Note: This tool uses LangGraph's interrupt() to pause execution while Unity compiles.
 * The interrupt is handled by the agent harness which communicates with Unity via WebSocket.
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';

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

/** Unity response body structure */
interface UnityCompileBody {
    compilationErrors?: string[];
    watchedScriptsStatus?: Record<string, boolean>;
}

/** Unity response structure */
interface UnityResponse {
    success: boolean;
    body?: UnityCompileBody;
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
    // BUILD THE REQUEST (will be sent to Unity by harness)
    // ---------------------------------------------------------
    const params: Record<string, unknown> = { typeLimit: type_limit };
    if (watched_scripts) {
        params.watchedScripts = watched_scripts;
    }

    const compileRequest = {
        action: 'refresh_assets',
        params
    };

    // ---------------------------------------------------------
    // INTERRUPT: Pause agent, let harness call Unity via WebSocket
    // ---------------------------------------------------------
    // The harness catches this, sends command to Unity via WebSocket,
    // waits for compilation to complete, then resumes with Unity's response
    console.log(`DEBUG: Pausing for compilation... request=${JSON.stringify(compileRequest)}`);
    const result = interrupt(compileRequest) as UnityResponse;
    console.log(`DEBUG: Resumed from compilation. result=${JSON.stringify(result)}`);

    // ---------------------------------------------------------
    // HANDLE TIMEOUT - Tell agent to check logs
    // ---------------------------------------------------------
    if (!result.success && result.error?.toLowerCase().includes('timeout')) {
        const timeoutResponse: CompilationTimeoutResponse = {
            status: 'TIMEOUT',
            message: 'Compilation timed out after 40 seconds. This usually means Unity encountered an issue during domain reload.',
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

    // ---------------------------------------------------------
    // SMART RESPONSE PARSING
    // ---------------------------------------------------------
    const body = result.body ?? {};
    const success = result.success;

    // Case 1: Compilation Failed
    if (!success || body.compilationErrors) {
        const errors = body.compilationErrors ?? [];
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
        message: 'Assets refreshed and scripts compiled.'
    };

    // Did we find the scripts the agent cared about?
    if (watched_scripts && body.watchedScriptsStatus) {
        response.verification = body.watchedScriptsStatus;

        // Helper text for the LLM
        const missing = Object.entries(body.watchedScriptsStatus)
            .filter(([_, found]) => !found)
            .map(([name]) => name);

        if (missing.length > 0) {
            response.warning = `Compilation passed, but these types are still missing: ${JSON.stringify(missing)}. Did you get the class name right inside the file?`;
        } else {
            response.next_step = "You can now use unity_component({ action: 'add' }) with these scripts.";
        }
    }

    return JSON.stringify(response, null, 2);
}

/**
 * The Compiler - unity_refresh tool
 * Trigger Unity Asset Database refresh and Script Compilation.
 *
 * Note: This tool is synchronous because interrupt() is synchronous.
 * The async behavior is handled by the LangGraph runtime.
 */
export const unityRefresh = new DynamicStructuredTool({
    name: 'unity_refresh',
    description: `Trigger Unity Asset Database refresh and Script Compilation. This is "The Compiler".

CRITICAL: You MUST use this tool after creating or editing C# scripts (.cs files).
Unity cannot add a component until the script is compiled.

Behavior:
1. Pauses agent execution while Unity compiles (handled by orchestrator).
2. Returns 'compilationErrors' if syntax errors exist.
3. Confirms if 'watched_scripts' are now valid components.`,
    schema: RefreshSchema,
    func: unityRefreshImpl
});
