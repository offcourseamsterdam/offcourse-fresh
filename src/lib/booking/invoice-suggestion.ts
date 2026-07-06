/**
 * Suggested "invoice later" amount for an admin-created booking billed to a partner.
 *
 * Mirrors the existing partner-invoice accounting model (see
 * partner-invoiced-listings.md): `commission_amount_cents` on the bookings table
 * is always the PARTNER's cut (what they keep); what we actually invoice them is
 * base_amount_cents - commission_amount_cents. This helper computes both directions
 * so the admin wizard can show a suggested invoice total while the server still
 * stores commission_amount_cents in the pre-existing shape.
 */

export interface InvoiceSuggestion {
  /** What to invoice the partner — base minus their commission cut. */
  suggestedInvoiceCents: number
  /** The partner's cut implied by the suggestion (0 when no campaign matched). */
  suggestedCommissionCents: number
  /** Whether an active campaign supplied the commission %, or this is a full-price fallback. */
  hasCampaign: boolean
  commissionPercent: number | null
}

/**
 * `campaign` is the active campaign linking this partner + listing, if any
 * (percentage commission only — fixed-amount campaigns aren't a per-booking
 * invoice suggestion here, since
 * they don't scale with this specific booking's price).
 */
export function computeInvoiceSuggestion(
  baseAmountCents: number,
  campaign: { percentage_value: number | null; investment_type: string | null } | null | undefined,
): InvoiceSuggestion {
  if (campaign?.investment_type === 'percentage' && campaign.percentage_value) {
    const commissionCents = Math.round(baseAmountCents * campaign.percentage_value / 100)
    return {
      suggestedInvoiceCents: baseAmountCents - commissionCents,
      suggestedCommissionCents: commissionCents,
      hasCampaign: true,
      commissionPercent: campaign.percentage_value,
    }
  }
  // No active revenue-share campaign — default to invoicing the full amount;
  // the admin can still override it in the UI.
  return {
    suggestedInvoiceCents: baseAmountCents,
    suggestedCommissionCents: 0,
    hasCampaign: false,
    commissionPercent: null,
  }
}

/** Inverse of the above: given the admin's final (possibly edited) invoice
 *  amount, derive the commission_amount_cents to store on the booking row. */
export function commissionFromInvoiceAmount(baseAmountCents: number, invoiceAmountCents: number): number {
  return Math.max(0, baseAmountCents - invoiceAmountCents)
}
