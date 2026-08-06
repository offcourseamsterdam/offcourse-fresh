import type { NextRequest } from 'next/server'

/**
 * Reconstructs the exact public URL a Twilio webhook was called on, for
 * signature verification — must match byte-for-byte (path AND query string)
 * or the signature never validates, even for a genuine Twilio request.
 * Built from our own trusted NEXT_PUBLIC_SITE_URL + the request's own
 * path/query (not the Host header, which a proxy could spoof).
 */
export function canonicalWebhookUrl(req: NextRequest): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'
  return `${base.replace(/\/$/, '')}${req.nextUrl.pathname}${req.nextUrl.search}`
}
