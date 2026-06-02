import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

// The bridge between Google Ads campaigns and our own marketing campaigns.
//
// A Google Ads campaign's Final URL is a /t/<slug> tracking link; that slug is a row
// in the `campaigns` table (the marketing/attribution campaigns). The marketing
// campaign already knows its listing (campaigns.listing_id), so the chain is:
//
//     Google Ads campaign  →  marketing campaign  →  listing (derived)
//
// The admin picks the MARKETING CAMPAIGN; the listing follows from it (read-only).
// Pure helper (listingUrl) is unit-tested; the rest is thin Supabase I/O. The
// Supabase client is injected (not imported) so this module stays free of the
// `server-only` guard and testable.

type DB = SupabaseClient<Database>

/** Derive a listing's public landing URL from its slug. Pure. */
export function listingUrl(
  slug: string,
  baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://offcourseamsterdam.com',
): string {
  return `${baseUrl.replace(/\/+$/, '')}/cruises/${slug}`
}

export interface LinkedListing {
  id: string
  slug: string
  title: string
}

/** A marketing campaign (a `campaigns` row) plus the listing it promotes. */
export interface LinkedCampaign {
  id: string
  name: string
  slug: string
  listing: LinkedListing | null
}

// Supabase types an embedded to-one as either an object or a 1-element array.
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

/** googleAdsCampaignId → the marketing campaign it's connected to (with derived listing). */
export async function getCampaignMarketingMap(supabase: DB): Promise<Record<string, LinkedCampaign>> {
  const { data, error } = await supabase
    .from('google_ads_campaign_listings')
    .select('campaign_id, marketing_campaign_id, listing_id, listing_slug, campaigns(name, slug), cruise_listings(title)')
  if (error || !data) return {}

  const map: Record<string, LinkedCampaign> = {}
  for (const row of data) {
    if (!row.marketing_campaign_id) continue
    const camp = one(row.campaigns as { name: string; slug: string } | { name: string; slug: string }[] | null)
    const listingTitle = one(row.cruise_listings as { title: string } | { title: string }[] | null)?.title
    map[row.campaign_id] = {
      id: row.marketing_campaign_id,
      name: camp?.name ?? row.marketing_campaign_id,
      slug: camp?.slug ?? '',
      listing:
        row.listing_id && row.listing_slug
          ? { id: row.listing_id, slug: row.listing_slug, title: listingTitle ?? row.listing_slug }
          : null,
    }
  }
  return map
}

/** All active marketing campaigns (with their derived listing) — the link dropdown options. */
export async function listMarketingCampaigns(supabase: DB): Promise<LinkedCampaign[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, slug, listing_id, cruise_listings(slug, title)')
    .eq('is_active', true)
    .order('name')
  if (error || !data) return []

  return data.map(c => {
    const l = one(c.cruise_listings as { slug: string; title: string } | { slug: string; title: string }[] | null)
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      listing: c.listing_id && l ? { id: c.listing_id, slug: l.slug, title: l.title ?? l.slug } : null,
    }
  })
}

/**
 * Connect a Google Ads campaign to a marketing campaign. Looks up that campaign's
 * listing and caches it on the bridge row (listing_id/listing_slug) for grouping +
 * URL building, but the marketing campaign is the source of truth.
 */
export async function setCampaignMarketing(supabase: DB, campaignId: string, marketingCampaignId: string) {
  const { data: camp, error: lookupErr } = await supabase
    .from('campaigns')
    .select('id, listing_id, cruise_listings(slug)')
    .eq('id', marketingCampaignId)
    .single()
  if (lookupErr || !camp) return { error: lookupErr ?? new Error('Marketing campaign not found') }

  const listingSlug = one(camp.cruise_listings as { slug: string } | { slug: string }[] | null)?.slug ?? null

  return supabase.from('google_ads_campaign_listings').upsert(
    {
      campaign_id: campaignId,
      marketing_campaign_id: marketingCampaignId,
      listing_id: camp.listing_id,
      listing_slug: listingSlug,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'campaign_id' },
  )
}

/** Connect a Google Ads campaign to a marketing campaign by its /t/ slug (used by the CLI). */
export async function setCampaignMarketingBySlug(supabase: DB, campaignId: string, marketingSlug: string) {
  const { data: camp } = await supabase.from('campaigns').select('id').eq('slug', marketingSlug).maybeSingle()
  if (!camp) return { error: new Error(`No marketing campaign with slug "${marketingSlug}"`) }
  return setCampaignMarketing(supabase, campaignId, camp.id)
}

/** Drop a campaign's marketing-campaign link entirely. */
export async function removeCampaignMarketing(supabase: DB, campaignId: string) {
  return supabase.from('google_ads_campaign_listings').delete().eq('campaign_id', campaignId)
}
