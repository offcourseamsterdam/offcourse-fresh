/**
 * Compute the commission amount (in cents) for a campaign given a base price.
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
    return Math.round(baseAmountCents * campaign.percentage_value / 100)
  }
  if (campaign.investment_type === 'fixed_amount') {
    return Math.round(campaign.percentage_value)
  }
  return null
}
