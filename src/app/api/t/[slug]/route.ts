import { NextRequest, NextResponse } from 'next/server'
import {
  resolveCampaign,
  buildAttributionCookie,
  buildGclidCookie,
  buildClickTypeCookie,
  appendClickId,
  logClick,
} from '@/lib/tracking/server'
import { pickClickId } from '@/lib/tracking/click-ids'

/**
 * GET /api/t/[slug]
 *
 * Tracking link redirect — the single capture point for BOTH ledgers:
 *  1. Look up campaign by slug
 *  2. Log a click in campaign_clicks
 *  3. Set the oc_attr attribution cookie (→ our DB, native campaign attribution)
 *  4. Capture Google's click id (auto-tagging appends ?gclid= / ?wbraid= /
 *     ?gbraid= when this link is a Google ad's Final URL) → set the oc_gclid +
 *     oc_click_type cookies and forward it onto the destination (→ Google
 *     conversion reporting via the Stripe webhook)
 *  5. Redirect to destination (listing page or homepage)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const url = new URL(request.url)
  // Use the request origin so preview deployments stay on the preview domain,
  // not redirect to production (offcourseamsterdam.com).
  const origin = url.origin
  const click = pickClickId((k) => url.searchParams.get(k))
  const attr = await resolveCampaign(slug, { siteUrl: origin })

  // Capture the click id (our data) on the response, whatever its kind.
  const setClickCookies = (res: NextResponse) => {
    if (!click) return
    const value = buildGclidCookie(click.value)
    const type = buildClickTypeCookie(click.type)
    res.cookies.set(value.name, value.value, value.options)
    res.cookies.set(type.name, type.value, type.options)
  }

  // Unknown campaign — still capture the click id before bouncing home.
  if (!attr) {
    const home = new URL('/', request.url)
    const dest = click ? appendClickId(home.toString(), click.value, click.type) : home
    const response = NextResponse.redirect(dest)
    setClickCookies(response)
    return response
  }

  // Await the click log — on Vercel the function freezes the moment the
  // redirect response is sent, so a fire-and-forget insert gets dropped.
  // Errors are still swallowed: a failed log must never block the redirect.
  await logClick(attr.campaign_id, request).catch(() => {})

  const destination = click
    ? appendClickId(attr.destination_url, click.value, click.type)
    : attr.destination_url
  const response = NextResponse.redirect(destination, 302)
  const cookie = buildAttributionCookie(attr)
  response.cookies.set(cookie.name, cookie.value, cookie.options)
  setClickCookies(response)
  return response
}
