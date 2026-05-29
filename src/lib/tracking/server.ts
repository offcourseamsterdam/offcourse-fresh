import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATTRIBUTION_COOKIE_DAYS, COOKIE_ATTRIBUTION, COOKIE_GCLID, COOKIE_CLICK_TYPE, GCLID_COOKIE_DAYS, USER_AGENT_MAX_LENGTH } from './constants'
import type { ClickType } from './click-ids'

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

/**
 * Build a click-id cookie set on the /t/<slug> redirect when a Google ad's
 * auto-tagging appended ?gclid= / ?wbraid= / ?gbraid= to the tracking link.
 * Same options as the attribution cookie; longer (90-day) window to match
 * Google's default conversion window. `name` is oc_gclid (value) or
 * oc_click_type (which kind).
 */
function buildClickCookie(name: string, value: string): AttributionCookie {
  return {
    name,
    value,
    options: {
      path: '/',
      maxAge: GCLID_COOKIE_DAYS * 86_400,
      sameSite: 'lax',
      httpOnly: false,
    },
  }
}

export const buildGclidCookie = (clickId: string) => buildClickCookie(COOKIE_GCLID, clickId)
export const buildClickTypeCookie = (type: ClickType) => buildClickCookie(COOKIE_CLICK_TYPE, type)

/**
 * Forward the click id onto the redirect destination so the landing page URL
 * still carries it (lets a future Consent Mode gtag register the click). `param`
 * is the click type so iOS ids are forwarded under the correct key. Returns the
 * url unchanged if it can't be parsed or already carries that param.
 */
export function appendClickId(url: string, value: string, param: ClickType = 'gclid'): string {
  try {
    const u = new URL(url)
    if (!u.searchParams.has(param)) u.searchParams.set(param, value)
    return u.toString()
  } catch {
    return url
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
