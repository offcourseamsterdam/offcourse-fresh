import { buildAgentCard } from '@/lib/a2a/agent-card'

// GET /.well-known/agent-card.json
// A2A Agent Card for agent-to-agent discovery
// (https://a2a-protocol.org/latest/topics/agent-discovery/). Points other
// agents at the JSON-RPC endpoint in src/app/api/a2a/route.ts.
//
// This path contains a literal dot, so proxy.ts's matcher already excludes
// it from locale redirection — same mechanism as /.well-known/api-catalog
// and /openapi.yaml. No proxy.ts change needed.
export function GET() {
  return Response.json(buildAgentCard())
}
