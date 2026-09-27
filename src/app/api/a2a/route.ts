import { NextRequest, NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { handleJsonRpcRequest } from '@/lib/a2a/handle-request'

// POST /api/a2a
// A2A protocol JSON-RPC 2.0 endpoint (https://a2a-protocol.org). Public,
// unauthenticated — same read-only data as /api/v1/*, reachable by other
// AI agents via the A2A wire format instead of plain REST. Supports
// `SendMessage` (runs a skill, see src/lib/a2a/skills.ts) and `GetTask`.
// Advertised at /.well-known/agent-card.json.
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, 'a2a', 60, 60_000)
  if (limited) return limited

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400 }
    )
  }

  const response = await handleJsonRpcRequest(body)
  return NextResponse.json(response)
}
