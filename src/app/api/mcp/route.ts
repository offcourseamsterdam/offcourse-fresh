import { NextRequest, NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { handleMcpRequest } from '@/lib/mcp/handle-request'

// POST /api/mcp
// Streamable HTTP transport for the Model Context Protocol
// (https://modelcontextprotocol.io), protocol version 2025-06-18. Public,
// unauthenticated, stateless — every request is handled independently (no
// session store), which the spec permits for a server with no
// server-initiated messages. Advertised at
// /.well-known/mcp/server-card.json.
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, 'mcp', 60, 60_000)
  if (limited) return limited

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 })
  }

  const response = await handleMcpRequest(body)
  if (response === null) {
    // A notification (no `id`) — per JSON-RPC 2.0, the server sends no body.
    return new NextResponse(null, { status: 202 })
  }
  return NextResponse.json(response)
}

// The Streamable HTTP transport allows GET to open a server-initiated SSE
// stream; this server never sends unsolicited messages, so there is nothing
// to stream. 405 is the spec-compliant response for a transport that
// doesn't support it.
export function GET() {
  return NextResponse.json({ error: 'This server does not support server-initiated streaming; use POST.' }, { status: 405 })
}
