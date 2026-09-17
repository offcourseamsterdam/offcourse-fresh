import { isSkillId, runSkill, SkillInputError } from '@/lib/a2a/skills'
import { MCP_TOOLS } from './tools'

/** The one MCP protocol revision this server implements — the stable, widely-deployed handshake-based ("legacy" per the 2026-07-28 versioning page) lifecycle. */
export const PROTOCOL_VERSION = '2025-06-18'

const SERVER_INFO = { name: 'Off Course Amsterdam', version: '1.0.0' }

interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id?: string | number | null
}

/** `null` means "notification — send no response", per JSON-RPC 2.0 (a request with no `id`). */
export type JsonRpcResult = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } } | null

function handleInitialize(params: unknown): unknown {
  const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO,
    instructions:
      'Read-only tools for Off Course Amsterdam canal cruises: list_cruises and check_availability. ' +
      (requested && requested !== PROTOCOL_VERSION
        ? `Note: this server only speaks protocol version ${PROTOCOL_VERSION}.`
        : ''),
  }
}

async function handleToolsCall(params: unknown): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const { name, arguments: args } = (params ?? {}) as { name?: unknown; arguments?: unknown }

  if (!isSkillId(name)) {
    return { content: [{ type: 'text', text: `Unknown tool "${String(name)}". Available: ${MCP_TOOLS.map((t) => t.name).join(', ')}` }], isError: true }
  }

  try {
    const result = await runSkill(name, args)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (err) {
    if (err instanceof SkillInputError) {
      return { content: [{ type: 'text', text: err.message }], isError: true }
    }
    console.error('[mcp] tool execution failed:', err)
    return { content: [{ type: 'text', text: 'Internal error running tool' }], isError: true }
  }
}

/**
 * Dispatches one JSON-RPC 2.0 message for the Streamable HTTP transport
 * (src/app/api/mcp/route.ts). Handles the full legacy lifecycle
 * (initialize → notifications/initialized → tools/list → tools/call) plus
 * ping. Returns `null` for notifications, which must get no response body.
 */
export async function handleMcpRequest(body: unknown): Promise<JsonRpcResult> {
  const req = body as Partial<JsonRpcRequest> | null
  const hasId = !!req && typeof req === 'object' && 'id' in req && req.id !== undefined
  const id = hasId ? (req!.id as string | number | null) : null

  if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return hasId ? { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } } : null
  }

  // Notifications (no `id`) get no response, per JSON-RPC 2.0.
  if (!hasId) {
    if (req.method !== 'notifications/initialized' && req.method !== 'notifications/cancelled') {
      console.warn(`[mcp] unhandled notification: ${req.method}`)
    }
    return null
  }

  switch (req.method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: handleInitialize(req.params) }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }
    case 'tools/call':
      return { jsonrpc: '2.0', id, result: await handleToolsCall(req.params) }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } }
  }
}
