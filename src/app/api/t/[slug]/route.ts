import { NextRequest, NextResponse } from 'next/server'
import { resolveCampaign, buildAttributionCookie, logClick } from '@/lib/tracking/server'

/**
 * GET /api/t/[slug]
 *
 * Tracking link redirect:
 *  1. Look up campaign by slug
 *  2. Log a click in campaign_clicks
 *  3. Set the oc_attr attribution cookie
 *  4. Redirect to destination (listing page or homepage)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const attr = await resolveCampaign(slug)

  if (!attr) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Fire-and-forget click log
  logClick(attr.campaign_id, request).catch(() => {})

  const response = NextResponse.redirect(attr.destination_url, 302)
  const cookie = buildAttributionCookie(attr)
  response.cookies.set(cookie.name, cookie.value, cookie.options)
  return response
}
