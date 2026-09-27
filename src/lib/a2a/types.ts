/**
 * Minimal TypeScript types for the pieces of the A2A protocol
 * (https://a2a-protocol.org) this server implements — the "latest"
 * (v1.0-line) JSON-RPC binding, verified against the canonical schema at
 * github.com/a2aproject/A2A/specification/a2a.proto and the reference
 * @a2a-js/sdk. Field names are camelCase per proto3 JSON mapping
 * (message_id → messageId); enum values keep their full proto name
 * ("ROLE_USER", "TASK_STATE_COMPLETED") since that's how the reference SDK
 * serializes them. Not a full implementation of the spec — see
 * src/app/api/a2a/route.ts for exactly which methods are supported.
 */

export type Role = 'ROLE_USER' | 'ROLE_AGENT'

export type TaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_REJECTED'
  | 'TASK_STATE_AUTH_REQUIRED'

/** A `Part` conveying structured JSON (the only Part variant this server produces or accepts). */
export interface DataPart {
  data: unknown
  mediaType?: string
}

/** A `Part` conveying plain text. */
export interface TextPart {
  text: string
  mediaType?: string
}

export type Part = DataPart | TextPart

export interface Message {
  messageId: string
  contextId?: string
  taskId?: string
  role: Role
  parts: Part[]
  metadata?: Record<string, unknown>
}

export interface Artifact {
  artifactId: string
  name?: string
  description?: string
  parts: Part[]
}

export interface TaskStatus {
  state: TaskState
  message?: Message
  timestamp: string
}

export interface Task {
  id: string
  contextId: string
  status: TaskStatus
  artifacts: Artifact[]
  history: Message[]
}

export interface AgentInterface {
  url: string
  protocolBinding: 'JSONRPC' | 'GRPC' | 'HTTP+JSON'
  protocolVersion: string
}

export interface AgentCapabilities {
  streaming: boolean
  pushNotifications: boolean
  extendedAgentCard: boolean
}

export interface AgentSkill {
  id: string
  name: string
  description: string
  tags: string[]
  examples?: string[]
  inputModes?: string[]
  outputModes?: string[]
}

export interface AgentProvider {
  url: string
  organization: string
}

export interface AgentCard {
  name: string
  description: string
  supportedInterfaces: AgentInterface[]
  provider?: AgentProvider
  version: string
  documentationUrl?: string
  capabilities: AgentCapabilities
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: AgentSkill[]
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id?: string | number | null
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: string | number | null
  result: unknown
}

export interface JsonRpcError {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError

/** JSON-RPC codes per the A2A spec's "A2A-Specific Errors" table + standard JSON-RPC 2.0. */
export const JSON_RPC_ERROR_CODE = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  UNSUPPORTED_OPERATION: -32004,
} as const
