/**
 * Utility functions for Movesia Agent Server.
 */

/**
 * Safely serialize an object to JSON-compatible format.
 * Handles circular references and non-serializable values.
 */
export function safeSerialize(obj: unknown): unknown {
    try {
        if (obj === null || obj === undefined) {
            return obj;
        }

        if (typeof obj === 'string' || typeof obj === 'number' ||
            typeof obj === 'boolean') {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(v => safeSerialize(v));
        }

        if (typeof obj === 'object') {
            const result: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = safeSerialize(value);
            }
            return result;
        }

        // For functions, symbols, etc.
        return String(obj);
    } catch {
        return String(obj);
    }
}

/**
 * Truncate large outputs for sending to client.
 *
 * Handles LangChain message objects (like ToolMessage) by extracting
 * their .content attribute instead of using toString().
 */
export function truncateOutput(output: unknown, maxLength: number = 1000): string {
    if (output === null || output === undefined) {
        return '';
    }

    // Extract content from LangChain message objects (ToolMessage, etc.)
    // These have a .content attribute with the actual data
    let outputStr: string;

    if (typeof output === 'object' && output !== null && 'content' in output) {
        outputStr = String((output as { content: unknown }).content);
    } else if (typeof output === 'string') {
        outputStr = output;
    } else {
        try {
            outputStr = JSON.stringify(output);
        } catch {
            outputStr = String(output);
        }
    }

    if (outputStr.length > maxLength) {
        return `${outputStr.slice(0, maxLength)}... (truncated, ${outputStr.length} total chars)`;
    }

    return outputStr;
}

/**
 * Deep clone an object using JSON serialization.
 * Note: This won't work for functions, symbols, or circular references.
 */
export function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Sleep for a specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a short random ID.
 */
export function generateShortId(length: number = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Format a date as ISO string without milliseconds.
 */
export function formatDate(date: Date = new Date()): string {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Check if a value is a plain object (not an array, null, etc.)
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        value.constructor === Object;
}
