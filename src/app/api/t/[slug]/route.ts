import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATTRIBUTION_COOKIE_DAYS } from '@/lib/tracking/constants'

/**
 * GET /api/t/[slug]
 *
 * Tracking link redirect. When a partner/campaign link is clicked:
 * 1. Look up the campaign_link by slug
 * 2. Log a click in campaign_clicks
 * 3. Upsert a campaign_session
 * 4. Set the oc_attr attribution cookie
 * 5. Redirect to the destination URL
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = createAdminClient()

  // Look up the campaign link
  const { data: link } = await supabase
    .from('campaign_links')
    .select('id, slug, destination_url, is_active, partner_id, campaign_id')
    .eq('slug', slug)
    .single()

  if (!link || !link.is_active) {
    // Unknown or inactive link — redirect to homepage
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Generate tokens for click/session tracking
  const sessionToken = crypto.randomUUID()
  const visitorToken = crypto.randomUUID()

  // Log the click (fire-and-forget — don't block the redirect)
  const clickPromise = supabase.from('campaign_clicks').insert({
    campaign_id: link.id,
    session_token: sessionToken,
    referrer: request.headers.get('referer') ?? null,
    user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
  })

  // Upsert campaign session
  const sessionPromise = supabase.from('campaign_sessions').insert({
    campaign_id: link.id,
    visitor_token: visitorToken,
    session_token: sessionToken,
  })

  // Don't wait for DB writes to complete before redirecting
  Promise.allSettled([clickPromise, sessionPromise]).catch(() => {})

  // Build attribution data for the cookie
  const attribution = {
    campaign_slug: link.slug,
    partner_id: link.partner_id,
    campaign_link_id: link.id,
    campaign_id: link.campaign_id,
  }

  // Build redirect response with attribution cookie
  const destination = new URL(link.destination_url)
  // Add campaign_slug as UTM param so the tracking script picks it up
  if (!destination.searchParams.has('ref')) {
    destination.searchParams.set('ref', link.slug)
  }

  const response = NextResponse.redirect(destination.toString(), 302)

  // Set the attribution cookie (first-party, 30 days)
  response.cookies.set('oc_attr', JSON.stringify(attribution), {
    path: '/',
    maxAge: ATTRIBUTION_COOKIE_DAYS * 86400,
    sameSite: 'lax',
    httpOnly: false, // Needs to be readable by client-side JS
  })

  return response
}
