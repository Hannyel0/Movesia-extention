import type { ToolCallData } from '../components/tools'

// Extended message type with tool calls display
export interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallData[]
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
}

export type ToolCallEventCallback = (event: ToolCallEvent, messageId: string) => void

// Thread type (re-export from ThreadSelector for convenience)
export type { Thread } from '../components/ThreadSelector'
