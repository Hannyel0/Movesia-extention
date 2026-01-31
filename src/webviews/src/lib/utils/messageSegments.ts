/**
 * Message Segment Generation Utility
 *
 * This module handles the interleaving of text content and tool calls
 * based on their position in the message stream.
 */

import type { ToolCallData } from '../components/tools'
import type { MessageSegment } from '../types/chat'

/**
 * Generates interleaved message segments from text content and tool calls.
 *
 * Tools with position information (textOffsetStart) are inserted at their
 * correct positions within the text. Tools without position info are
 * appended at the end for backward compatibility.
 *
 * @param textContent - The full text content of the message
 * @param toolCalls - Array of tool calls, potentially with position info
 * @returns Array of segments in the correct order for rendering
 */
export function generateMessageSegments(
  textContent: string,
  toolCalls: ToolCallData[]
): MessageSegment[] {
  // Early return if no content at all
  if (!textContent && toolCalls.length === 0) {
    return []
  }

  // If no tools, just return text segment
  if (toolCalls.length === 0) {
    return textContent ? [{ type: 'text', content: textContent }] : []
  }

  // Separate tools with and without position info
  const toolsWithPosition = toolCalls.filter(t => t.textOffsetStart !== undefined)
  const toolsWithoutPosition = toolCalls.filter(t => t.textOffsetStart === undefined)

  // If no tools have position info, use fallback (tools first, then text)
  if (toolsWithPosition.length === 0) {
    const segments: MessageSegment[] = []

    // Add all tools first
    for (const tool of toolCalls) {
      segments.push({ type: 'tool', tool })
    }

    // Then add text if present
    if (textContent) {
      segments.push({ type: 'text', content: textContent })
    }

    return segments
  }

  // Sort tools by their start position
  const sortedTools = [...toolsWithPosition].sort(
    (a, b) => (a.textOffsetStart ?? 0) - (b.textOffsetStart ?? 0)
  )

  const segments: MessageSegment[] = []
  let lastTextEnd = 0

  for (const tool of sortedTools) {
    const toolStart = tool.textOffsetStart ?? lastTextEnd

    // Clamp to valid range
    const clampedStart = Math.min(Math.max(0, toolStart), textContent.length)

    // Add text before this tool (if any)
    if (clampedStart > lastTextEnd) {
      const textBefore = textContent.slice(lastTextEnd, clampedStart)
      if (textBefore) {
        segments.push({ type: 'text', content: textBefore })
      }
    }

    // Add the tool
    segments.push({ type: 'tool', tool })

    // Update cursor - use textOffsetEnd if available, otherwise stay at start
    // (text continues from the same position after the tool)
    lastTextEnd = clampedStart
  }

  // Add remaining text after last tool
  if (lastTextEnd < textContent.length) {
    const remainingText = textContent.slice(lastTextEnd)
    if (remainingText) {
      segments.push({ type: 'text', content: remainingText })
    }
  }

  // Append tools without position info at the end
  for (const tool of toolsWithoutPosition) {
    segments.push({ type: 'tool', tool })
  }

  return segments
}

/**
 * Check if a message has any tools with position information.
 * Useful for determining if interleaved rendering should be used.
 */
export function hasPositionedTools(toolCalls: ToolCallData[]): boolean {
  return toolCalls.some(t => t.textOffsetStart !== undefined)
}
