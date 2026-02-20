/**
 * THE OBSERVER'S EYE: unity_screenshot
 * "I need to see what's happening in the Unity Editor."
 * Consumes: capture_screenshot (unified endpoint)
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { callUnityAsync } from '../unity-tools/connection';

/**
 * Zod schema for unity_screenshot tool input
 */
export const ScreenshotSchema = z.object({
    source: z.enum(['sceneView', 'gameView', 'scene', 'game'])
        .default('sceneView')
        .describe("Which editor window to capture: 'sceneView' (default) or 'gameView'")
});

/** Type inferred from the Zod schema */
export type ScreenshotInput = z.infer<typeof ScreenshotSchema>;

/**
 * Capture a screenshot of the Unity Editor.
 *
 * NOTE: Returns Promise<any> instead of Promise<string> because LangChain agents
 * accept complex content arrays at runtime for multimodal inputs.
 */
async function unityScreenshotImpl(input: ScreenshotInput, _config?: unknown): Promise<any> {
    const { source } = input;

    console.log(`[unity_screenshot] Capturing screenshot from: ${source}`);

    // Normalize source to canonical form
    const normalizedSource = source === 'scene' ? 'sceneView'
        : source === 'game' ? 'gameView'
        : source;

    const result = await callUnityAsync('capture_screenshot', {
        source: normalizedSource
    });

    // If successful, the result contains imageBase64
    if ((result as any).success && (result as any).imageBase64) {
        const response = result as any;
        const base64Raw = response.imageBase64;

        // Create Data URI with JPEG prefix (Unity sends JPEG data)
        const dataUri = `data:image/jpeg;base64,${base64Raw}`;

        // Debug logging for multimodal content
        console.log(`[unity_screenshot] ✅ Screenshot captured successfully`);
        console.log(`[unity_screenshot]   Source: ${response.source}`);
        console.log(`[unity_screenshot]   Dimensions: ${response.width}x${response.height}`);
        console.log(`[unity_screenshot]   Base64 length: ${base64Raw.length} chars`);
        console.log(`[unity_screenshot]   Data URI prefix: ${dataUri.substring(0, 50)}...`);

        // Return multimodal content array that LangChain expects
        // This tells the agent: "Here is some text, AND here is an image to look at."
        const multimodalContent = [
            {
                type: "text",
                text: `Screenshot captured successfully from ${response.source}. Dimensions: ${response.width}x${response.height}.`
            },
            {
                type: "image_url",
                image_url: {
                    url: dataUri
                }
            }
        ];

        console.log(`[unity_screenshot] Returning multimodal content array with ${multimodalContent.length} items`);
        console.log(`[unity_screenshot]   Item 0: type="${multimodalContent[0].type}"`);
        console.log(`[unity_screenshot]   Item 1: type="${multimodalContent[1].type}", has image_url=${!!multimodalContent[1].image_url}`);

        return multimodalContent;
    }

    // On failure, return standard JSON string
    console.log(`[unity_screenshot] ❌ Screenshot failed:`, JSON.stringify(result, null, 2));
    return JSON.stringify(result, null, 2);
}

/**
 * The Observer's Eye - unity_screenshot tool
 * Capture screenshots of the Unity Editor to see what's happening.
 */
export const unityScreenshot = new DynamicStructuredTool({
    name: 'unity_screenshot',
    description: `Capture a screenshot of the Unity Editor's Scene View or Game View.

Use this tool to:
- Verify your ProBuilder mesh looks correct after creation/modification
- Check the visual result of material assignments
- See the current state of the scene before making changes
- Debug visual issues

PARAMETERS:
- source: 'sceneView' (default) or 'gameView'
  - sceneView: Shows the editor view with gizmos, grid, selection outlines
  - gameView: Shows what the player camera sees

RETURNS:
- imageBase64: Base64-encoded JPEG image (768px max dimension)
- width, height: Image dimensions
- source: Which view was captured

TIPS:
- Capture AFTER making changes (allow a moment for the framebuffer to update)
- Scene View shows gizmos and selection outlines - useful for seeing mesh structure
- Game View shows the final rendered result

EXAMPLE:
  unity_screenshot({ source: 'sceneView' })`,
    schema: ScreenshotSchema,
    func: unityScreenshotImpl
});
