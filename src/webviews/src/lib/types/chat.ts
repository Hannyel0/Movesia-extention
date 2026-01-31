import type { ToolCallData } from '../components/tools'

// Extended message type with tool calls display
export interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallData[]
  /** Interleaved segments for rendering (text and tools in order) */
  segments?: MessageSegment[]
}

// Tool call tracker - stores tool calls for the current streaming session
export interface StreamingToolCalls {
  backendMessageId: string
  tools: Map<string, ToolCallData>
}

// Tool call event types from SSE
export interface ToolCallEvent {
  type: 'tool-start' | 'tool-input' | 'tool-output' | 'tool-error'
  toolCallId: string
  toolName?: string
  input?: unknown
  output?: unknown
  error?: string
  /** Character count in the accumulated text when this event fired */
  textLengthAtEvent?: number
}

// Segment types for interleaved rendering
export interface TextSegment {
  type: 'text'
  content: string
}

export interface ToolSegment {
  type: 'tool'
  tool: import('../components/tools').ToolCallData
}

export type MessageSegment = TextSegment | ToolSegment

export type ToolCallEventCallback = (event: ToolCallEvent, messageId: string) => void

// Thread type (re-export from ThreadSelector for convenience)
export type { Thread } from '../components/ThreadSelector'
