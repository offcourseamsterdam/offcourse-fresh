import { createAdminClient } from '@/lib/supabase/admin'
import { commissionForCampaign } from './commission'

export interface CampaignCommission {
  campaignId: string
  partnerId: string | null
  commissionAmountCents: number | null
}

type RateConfig = { percentage_value: number | null; investment_type: string | null }

export interface RateCandidate extends RateConfig {
  listing_id: string | null
  category: string | null
}

/**
 * Pick which of a partner's campaigns sets the commission RATE for a booking.
 *
 * The campaign a customer clicked is not always the product they booked: someone
 * lands via a partner's shared-cruise link, looks around, and books a private
 * cruise. The partner's deal is per product (e.g. Things To Do: 25% shared, 20%
 * private), so the rate must follow what was booked, not the link. Found 2026-09:
 * private bookings via a shared link paid 25%, shared bookings via a private
 * link paid 20%.
 *
 * Order: the clicked campaign when it already matches the booked listing (or its
 * category, or either side is unknown) → the partner's campaign for that exact
 * listing → the partner's campaign for the same category → the clicked campaign
 * (no better match exists, so keep the old behavior).
 *
 * Only the rate moves — attribution (`campaignId`) stays on the clicked link, so
 * click/conversion tracking per link remains honest.
 */
export function pickRateCampaign(
  clicked: RateCandidate,
  booked: { id: string; category: string | null },
  siblings: RateCandidate[],
): RateConfig {
  if (!clicked.listing_id || clicked.listing_id === booked.id) return clicked
  if (!booked.category || !clicked.category || clicked.category === booked.category) return clicked
  return (
    siblings.find(s => s.listing_id === booked.id) ??
    siblings.find(s => s.category === booked.category) ??
    clicked
  )
}

/**
 * Given a campaign id, look up the campaign and resolve `{campaignId, partnerId,
 * commissionAmountCents}` for a booking's base amount. Returns `null` if the
 * campaign doesn't exist (e.g. deleted after a cookie/PaymentIntent referencing
 * it was created) — never throws, since attribution lookups are non-fatal.
 *
 * `partnerId` is always read fresh off the campaign row, never from a caller-
 * supplied snapshot (a cookie payload, PI metadata, etc.) — that FK is
 * continuously enforced by Postgres, so it's guaranteed current, whereas a
 * snapshot can go stale (the customer books days after a click; an admin
 * reassigns the campaign to a different partner in between).
 *
 * Pass `bookedListingId` so the rate follows the booked product (see
 * `pickRateCampaign`). The extra lookups only run on a listing mismatch.
 */
export async function resolveCampaignCommission(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  baseAmountCents: number,
  bookedListingId?: string | null,
): Promise<CampaignCommission | null> {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('partner_id, listing_id, percentage_value, investment_type, cruise_listings ( category )')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return null

  let rate: RateConfig = campaign
  if (bookedListingId && campaign.partner_id && campaign.listing_id && campaign.listing_id !== bookedListingId) {
    try {
      const [{ data: booked }, { data: siblings }] = await Promise.all([
        supabase.from('cruise_listings').select('id, category').eq('id', bookedListingId).maybeSingle(),
        supabase
          .from('campaigns')
          .select('listing_id, percentage_value, investment_type, cruise_listings ( category )')
          .eq('partner_id', campaign.partner_id),
      ])
      if (booked) {
        rate = pickRateCampaign(
          toCandidate(campaign),
          booked,
          (siblings ?? []).map(toCandidate),
        )
      }
    } catch {
      // Non-fatal: fall back to the clicked campaign's own rate
    }
  }

  return {
    // The row is only queried BY this id, so it's already known-correct —
    // no need to round-trip it through the SELECT.
    campaignId,
    partnerId: campaign.partner_id ?? null,
    commissionAmountCents: commissionForCampaign(rate, baseAmountCents),
  }
}

function toCandidate(row: RateConfig & { listing_id: string | null; cruise_listings?: { category: string | null } | null }): RateCandidate {
  return {
    listing_id: row.listing_id,
    percentage_value: row.percentage_value,
    investment_type: row.investment_type,
    category: row.cruise_listings?.category ?? null,
  }
}
