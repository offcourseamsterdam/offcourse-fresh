import { createAdminClient } from '@/lib/supabase/admin'
import { commissionForCampaign } from './commission'

export interface CampaignCommission {
  campaignId: string
  partnerId: string | null
  commissionAmountCents: number | null
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
 */
export async function resolveCampaignCommission(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  baseAmountCents: number,
): Promise<CampaignCommission | null> {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('partner_id, percentage_value, investment_type')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return null
  return {
    // The row is only queried BY this id, so it's already known-correct —
    // no need to round-trip it through the SELECT.
    campaignId,
    partnerId: campaign.partner_id ?? null,
    commissionAmountCents: commissionForCampaign(campaign, baseAmountCents),
  }
}
