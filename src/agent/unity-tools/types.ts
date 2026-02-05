/**
 * Shared types for Unity tools
 */

/**
 * Standard response from Unity WebSocket calls
 */
export interface UnityResponse {
    success: boolean;
    body?: Record<string, unknown>;
    error?: string;
    hint?: string;
    compilationErrors?: string[];
}

/**
 * Unity Manager interface - matches the actual UnityManager class in UnityConnection.
 *
 * Note: sendAndWait returns Record<string, unknown> from the actual implementation.
 * The tools cast/validate the response to UnityResponse as needed.
 */
export interface UnityManager {
    isConnected: boolean;
    sendAndWait(action: string, params: Record<string, unknown>, timeout?: number): Promise<Record<string, unknown>>;
}

/**
 * Tool error response for validation failures
 */
export interface ToolErrorResponse {
    error: string;
    hint: string;
    example: string;
}

/**
 * Vector3 as array format (Unity convention)
 */
export type Vector3 = [number, number, number];
