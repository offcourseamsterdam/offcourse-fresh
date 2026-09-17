export interface CustomerTypeRate {
  name: string
  customer_type_pk: number
  price_cents: number | null
}

/**
 * Narrows a FareHarbor item's full customer-type list down to the ones this
 * listing actually sells, per the Layer 2 filter (see CLAUDE.md's "3-Layer
 * Availability Filter System"). An empty/null allow-list means the listing
 * hasn't restricted durations, so every customer type is shown.
 */
export function selectAllowedCustomerTypes(
  rawTypes: CustomerTypeRate[],
  allowedPks: number[] | null | undefined
): CustomerTypeRate[] {
  if (!allowedPks || allowedPks.length === 0) return rawTypes
  return rawTypes.filter((ct) => allowedPks.includes(ct.customer_type_pk))
}

/** Formats a FareHarbor rate in cents as a euro price string, e.g. 31000 → "€310". */
export function formatRatePrice(priceCents: number | null): string {
  if (priceCents == null) return 'Price on request'
  return `€${(priceCents / 100).toFixed(2).replace('.00', '')}`
}
