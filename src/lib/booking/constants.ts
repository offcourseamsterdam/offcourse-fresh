/**
 * Shared booking money constants.
 *
 * Single source of truth for values that show up on legal/financial documents
 * (invoices, settlements) AND in the live pricing path. Keeping them here means
 * a rate change (e.g. the Amsterdam municipality raising the tourist tax) is one
 * edit, not a hunt across pricing, settlement, finance, and the invoice PDF.
 */

/** Amsterdam tourist/city tax — a per-guest municipal pass-through, 0% VAT. */
export const CITY_TAX_CENTS_PER_GUEST = 260

/** Dutch VAT rate applied to the cruise itself (the base fare). */
export const CRUISE_VAT_RATE = 9

/** Dutch VAT rate applied to food/drink extras. */
export const EXTRAS_VAT_RATE = 21
