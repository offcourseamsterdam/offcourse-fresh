/** Dutch VAT on boat rental (hoog-laag: 9%). The base price a customer pays includes it. */
export const BOAT_VAT_DIVISOR = 1.09

/**
 * Compute the commission amount (in cents) for a campaign given a base price.
 *
 * Percentage commissions are calculated over the price EXCLUDING the 9% VAT
 * (we remit that VAT to the tax office, so it was never ours to share). `baseAmountCents`
 * is the customer-facing price incl. VAT; we divide it out here. Applies from
 * 2026-10-01 — bookings created earlier keep the commission stored on their row.
 * Fixed-amount commissions are not VAT-adjusted.
 *
 * Quirk: when `investment_type === 'fixed_amount'` the fixed cents amount is
 * stored in the `percentage_value` column too (the column is reused). Preserve
 * that semantic — it's not a bug, it's how the schema is.
 *
 * Returns `null` when the campaign has no valid commission setup (missing value,
 * unknown investment_type) so the caller can leave `commission_amount_cents`
 * NULL in the DB instead of writing 0.
 */
export function commissionForCampaign(
  campaign: { percentage_value: number | null; investment_type: string | null } | null | undefined,
  baseAmountCents: number,
): number | null {
  if (!campaign?.percentage_value) return null
  if (campaign.investment_type === 'percentage') {
    return Math.round(baseAmountCents * campaign.percentage_value / 100 / BOAT_VAT_DIVISOR)
  }
  if (campaign.investment_type === 'fixed_amount') {
    return Math.round(campaign.percentage_value)
  }
  return null
}
