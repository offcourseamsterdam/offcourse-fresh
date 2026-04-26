import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATTRIBUTION_COOKIE_DAYS, COOKIE_ATTRIBUTION, USER_AGENT_MAX_LENGTH } from './constants'

/**
 * Server-side campaign tracking utilities.
 * Used by /api/t/[slug] (redirect path) and /api/track/visit (direct ?ref= path)
 * so both entry points produce identical telemetry.
 */

export interface CampaignAttribution {
  campaign_slug: string
  campaign_id: string
  partner_id: string | null
  campaign_link_id: null
  destination_url: string
}

interface ResolveContext {
  /** Used to build the destination URL when a campaign points to a listing. */
  siteUrl?: string
}

const DEFAULT_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

export async function resolveCampaign(
  slug: string,
  ctx: ResolveContext = {},
): Promise<CampaignAttribution | null> {
  if (!slug) return null
  const supabase = createAdminClient()

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, slug, partner_id, listing_id, is_active')
    .eq('slug', slug)
    .maybeSingle()

  if (!campaign || campaign.is_active === false) return null

  const siteUrl = ctx.siteUrl ?? DEFAULT_SITE_URL
  let destinationUrl = siteUrl

  if (campaign.listing_id) {
    const { data: listing } = await supabase
      .from('cruise_listings')
      .select('slug')
      .eq('id', campaign.listing_id)
      .maybeSingle()
    if (listing?.slug) {
      destinationUrl = `${siteUrl}/en/cruises/${listing.slug}`
    }
  }

  return {
    campaign_slug: campaign.slug,
    campaign_id: campaign.id,
    partner_id: campaign.partner_id,
    campaign_link_id: null,
    destination_url: destinationUrl,
  }
}

export interface AttributionCookie {
  name: string
  value: string
  options: {
    path: string
    maxAge: number
    sameSite: 'lax'
    httpOnly: false
  }
}

export function buildAttributionCookie(attr: CampaignAttribution): AttributionCookie {
  const payload = {
    campaign_slug: attr.campaign_slug,
    campaign_id: attr.campaign_id,
    partner_id: attr.partner_id,
    campaign_link_id: attr.campaign_link_id,
  }
  return {
    name: COOKIE_ATTRIBUTION,
    value: JSON.stringify(payload),
    options: {
      path: '/',
      maxAge: ATTRIBUTION_COOKIE_DAYS * 86_400,
      sameSite: 'lax',
      httpOnly: false,
    },
  }
}

export async function logClick(campaignId: string, request: NextRequest): Promise<void> {
  const supabase = createAdminClient()
  const sessionToken = crypto.randomUUID()
  await supabase.from('campaign_clicks').insert({
    campaign_id: campaignId,
    session_token: sessionToken,
    referrer: request.headers.get('referer') ?? null,
    user_agent: request.headers.get('user-agent')?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
  })
}
