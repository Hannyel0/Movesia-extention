import type { ToolCallEventCallback } from '../types/chat'

// Debug logging helper
const DEBUG = true
function log(category: string, message: string, data?: unknown) {
  if (DEBUG) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12)
    if (data !== undefined) {
      console.log(`[${timestamp}] [${category}] ${message}`, data)
    } else {
      console.log(`[${timestamp}] [${category}] ${message}`)
    }
  }
}

/**
 * Parse SSE stream and convert to UIMessageChunk stream.
 * Also extracts tool call events and forwards them to the callback.
 *
 * This function intercepts the raw SSE stream from the backend and:
 * 1. Parses each SSE line into JSON chunks
 * 2. Extracts tool call events (tool-input-start, tool-input-available, tool-output-available)
 * 3. Forwards tool events to the callback for independent tracking
 * 4. Passes all chunks through to the AI SDK for message handling
 */
export function createUIMessageChunkStream(
  response: Response,
  onToolCallEvent?: ToolCallEventCallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ReadableStream<any> {
  log('SSE', 'Creating UIMessageChunk stream from response')
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let chunkCount = 0
  let currentMessageId = ''
  // Track accumulated text length for tool position tracking
  let accumulatedTextLength = 0

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()

        if (done) {
          log('SSE', 'Stream complete (done=true)')
          controller.close()
          return
        }

        const decoded = decoder.decode(value, { stream: true })
        buffer += decoded
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') {
              log('SSE', 'Received [DONE] signal')
              controller.close()
              return
            }
            try {
              const chunk = JSON.parse(data)
              chunkCount++

              // Log first few chunks and then every 10th
              if (chunkCount <= 3 || chunkCount % 10 === 0) {
                log('SSE', `Chunk #${chunkCount}: type=${chunk.type}`, chunk)
              }

              // Track message ID from start event and reset text accumulator
              if (chunk.type === 'start' && chunk.messageId) {
                currentMessageId = chunk.messageId
                accumulatedTextLength = 0 // Reset for new message
                log('SSE', `Message started: ${currentMessageId}`)
              }

              // Track text accumulation for position tracking
              if (chunk.type === 'text-delta' && chunk.delta) {
                accumulatedTextLength += chunk.delta.length
              }

              // Extract tool call events and forward to callback with position info
              if (onToolCallEvent && currentMessageId) {
                if (chunk.type === 'tool-input-start') {
                  log('ToolTrack', `Tool start: ${chunk.toolName} at position ${accumulatedTextLength}`, chunk)
                  onToolCallEvent(
                    {
                      type: 'tool-start',
                      toolCallId: chunk.toolCallId,
                      toolName: chunk.toolName,
                      textLengthAtEvent: accumulatedTextLength,
                    },
                    currentMessageId
                  )
                } else if (chunk.type === 'tool-input-available') {
                  log('ToolTrack', `Tool input available: ${chunk.toolName} at position ${accumulatedTextLength}`, chunk)
                  onToolCallEvent(
                    {
                      type: 'tool-input',
                      toolCallId: chunk.toolCallId,
                      toolName: chunk.toolName,
                      input: chunk.input,
                      textLengthAtEvent: accumulatedTextLength,
                    },
                    currentMessageId
                  )
                } else if (chunk.type === 'tool-output-available') {
                  log('ToolTrack', `Tool output available at position ${accumulatedTextLength}`, chunk)
                  onToolCallEvent(
                    {
                      type: 'tool-output',
                      toolCallId: chunk.toolCallId,
                      output: chunk.output,
                      textLengthAtEvent: accumulatedTextLength,
                    },
                    currentMessageId
                  )
                } else if (chunk.type === 'error') {
                  log('ToolTrack', `Error`, chunk)
                  // Note: errors might not have toolCallId
                }
              }

              controller.enqueue(chunk)
            } catch (parseErr) {
              log('SSE', `Failed to parse JSON: "${data.slice(0, 100)}"`, parseErr)
            }
          }
        }
      } catch (err) {
        log('SSE', 'Stream error', err)
        controller.error(err)
      }
    },
    cancel() {
      log('SSE', 'Stream cancelled')
      reader.cancel()
    },
  })
}
