import { ACP_VERSION } from '@/lib/acp/types'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

// GET /.well-known/acp.json
// Agentic Commerce Protocol discovery document (https://agenticcommerce.dev).
// Points at the real Checkout Sessions API in src/app/api/acp/checkout_sessions —
// every field here matches what that API actually implements.
export function GET() {
  return Response.json({
    protocol: { name: 'acp', version: ACP_VERSION },
    api_base_url: `${SITE_URL}/api/acp`,
    transports: ['https'],
    capabilities: { services: ['checkout'] },
  })
}
