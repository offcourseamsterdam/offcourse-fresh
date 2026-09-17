// GET /.well-known/api-catalog
// API catalog for automated discovery, per RFC 9727
// (https://www.rfc-editor.org/rfc/rfc9727). Points agents/tools at the
// public read-only API: its OpenAPI spec, human docs, and health status.
//
// This path contains a literal dot, so proxy.ts's matcher already excludes
// it from locale redirection (same mechanism that lets /openapi.yaml and
// every /public asset bypass it) — no proxy.ts change needed.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

export function GET() {
  const catalog = {
    linkset: [
      {
        anchor: `${SITE_URL}/api/v1`,
        'service-desc': [{ href: `${SITE_URL}/openapi.yaml`, type: 'application/yaml' }],
        'service-doc': [{ href: `${SITE_URL}/api/v1/docs`, type: 'text/html' }],
        status: [{ href: `${SITE_URL}/api/v1/status`, type: 'application/json' }],
      },
    ],
  }

  return new Response(JSON.stringify(catalog), {
    headers: { 'Content-Type': 'application/linkset+json' },
  })
}
