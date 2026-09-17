import { MCP_TOOLS } from '@/lib/mcp/tools'
import { PROTOCOL_VERSION } from '@/lib/mcp/handle-request'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

// GET /.well-known/mcp/server-card.json
// MCP Server Card for pre-connection discovery, per SEP-1649
// (github.com/modelcontextprotocol/modelcontextprotocol/pull/2127). Points
// at the real, working Streamable HTTP endpoint in src/app/api/mcp/route.ts
// — every field here matches what that endpoint actually does over the
// wire, not aspirational capabilities.
export function GET() {
  return Response.json({
    serverInfo: { name: 'Off Course Amsterdam', version: '1.0.0' },
    description: 'Read-only MCP tools for Off Course Amsterdam canal cruises: list cruises with pricing, and check live availability.',
    endpoint: `${SITE_URL}/api/mcp`,
    transport: 'streamable-http',
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
    documentationUrl: `${SITE_URL}/api/v1/docs`,
  })
}
