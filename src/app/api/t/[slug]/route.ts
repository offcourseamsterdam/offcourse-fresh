import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATTRIBUTION_COOKIE_DAYS } from '@/lib/tracking/constants'

/**
 * GET /api/t/[slug]
 *
 * Tracking link redirect. When a partner/campaign link is clicked:
 * 1. Look up by slug — first in campaign_links, then in campaigns
 * 2. Log a click in campaign_clicks
 * 3. Set the oc_attr attribution cookie
 * 4. Redirect to the destination (listing page or homepage)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = createAdminClient()
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

  // ── 1. Try campaign_links table first (legacy partner links) ────────
  const { data: link } = await supabase
    .from('campaign_links')
    .select('id, slug, destination_url, is_active, partner_id, campaign_id')
    .eq('slug', slug)
    .maybeSingle()

  if (link && link.is_active) {
    // Campaign link found — use its destination_url directly
    return handleRedirect(request, supabase, {
      destinationUrl: link.destination_url,
      attribution: {
        campaign_slug: link.slug,
        partner_id: link.partner_id,
        campaign_link_id: link.id,
        campaign_id: link.campaign_id,
      },
    })
  }

  // ── 2. Try campaigns table (new campaign system) ────────────────────
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, slug, partner_id, listing_id, is_active')
    .eq('slug', slug)
    .maybeSingle()

  if (campaign && campaign.is_active !== false) {
    // Build destination URL from listing or default to homepage
    let destinationUrl = siteUrl

    if (campaign.listing_id) {
      // Look up the cruise listing slug
      const { data: listing } = await supabase
        .from('cruise_listings')
        .select('slug')
        .eq('id', campaign.listing_id)
        .maybeSingle()

      if (listing?.slug) {
        destinationUrl = `${siteUrl}/en/cruises/${listing.slug}`
      }
    }

    return handleRedirect(request, supabase, {
      destinationUrl,
      attribution: {
        campaign_slug: campaign.slug,
        partner_id: campaign.partner_id,
        campaign_link_id: null,
        campaign_id: campaign.id,
      },
    })
  }

  // ── 3. Unknown slug — redirect to homepage ──────────────────────────
  return NextResponse.redirect(new URL('/', request.url))
}

// ── Shared redirect helper ────────────────────────────────────────────────

interface RedirectOptions {
  destinationUrl: string
  attribution: {
    campaign_slug: string
    partner_id: string | null
    campaign_link_id: string | null
    campaign_id: string | null
  }
}

async function handleRedirect(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  { destinationUrl, attribution }: RedirectOptions,
) {
  // Log the click (fire-and-forget)
  const sessionToken = crypto.randomUUID()
  const clickCampaignId = attribution.campaign_link_id ?? attribution.campaign_id
  if (clickCampaignId) {
    Promise.allSettled([
      supabase.from('campaign_clicks').insert({
        campaign_id: clickCampaignId,
        session_token: sessionToken,
        referrer: request.headers.get('referer') ?? null,
        user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
      }),
    ])
  }

  // Build redirect URL with ?ref param
  const destination = new URL(destinationUrl)
  if (!destination.searchParams.has('ref')) {
    destination.searchParams.set('ref', attribution.campaign_slug)
  }

  const response = NextResponse.redirect(destination.toString(), 302)

  // Set the attribution cookie (first-party, 30 days)
  response.cookies.set('oc_attr', JSON.stringify(attribution), {
    path: '/',
    maxAge: ATTRIBUTION_COOKIE_DAYS * 86400,
    sameSite: 'lax',
    httpOnly: false,
  })

  return response
}
