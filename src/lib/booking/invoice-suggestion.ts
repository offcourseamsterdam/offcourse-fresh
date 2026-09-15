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

export interface InvoiceSuggestionOptions {
  partnerCommissionRate?: number | null
  extrasAmountCents?: number | null
  cityTaxCents?: number | null
  commissionOnNetBaseOnly?: boolean
}

export interface InvoiceSuggestion {
  /** What to invoice the partner — base minus their commission cut. */
  suggestedInvoiceCents: number
  /** The partner's cut implied by the suggestion (0 when no campaign matched). */
  suggestedCommissionCents: number
  /** Whether an active campaign supplied the commission %, or this is a full-price fallback. */
  hasCampaign: boolean
  commissionPercent: number | null
  baseExVatCents?: number
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
  options?: InvoiceSuggestionOptions,
): InvoiceSuggestion {
  let commissionPercent: number | null = null
  let hasCampaign = false

  if (campaign?.investment_type === 'percentage' && campaign.percentage_value) {
    commissionPercent = campaign.percentage_value
    hasCampaign = true
  } else if (options?.partnerCommissionRate && options.partnerCommissionRate > 0) {
    commissionPercent = options.partnerCommissionRate
    hasCampaign = false
  }

  const extras = options?.extrasAmountCents ?? 0
  const cityTax = options?.cityTaxCents ?? 0

  if (commissionPercent && commissionPercent > 0) {
    if (options?.commissionOnNetBaseOnly) {
      const baseExVatCents = Math.round(baseAmountCents / 1.09)
      const commissionExVatCents = Math.round(baseExVatCents * commissionPercent / 100)
      const commissionGrossCents = Math.round(commissionExVatCents * 1.09)
      return {
        suggestedInvoiceCents: (baseAmountCents - commissionGrossCents) + extras + cityTax,
        suggestedCommissionCents: commissionExVatCents,
        hasCampaign,
        commissionPercent,
        baseExVatCents,
      }
    }

    const commissionCents = Math.round(baseAmountCents * commissionPercent / 100)
    return {
      suggestedInvoiceCents: (baseAmountCents - commissionCents) + extras + cityTax,
      suggestedCommissionCents: commissionCents,
      hasCampaign,
      commissionPercent,
    }
  }

  // No active revenue-share campaign or partner rate — default to invoicing the full amount;
  // the admin can still override it in the UI.
  return {
    suggestedInvoiceCents: baseAmountCents + extras + cityTax,
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
