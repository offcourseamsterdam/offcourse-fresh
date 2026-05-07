/**
 * Catering filter helpers.
 *
 * "Catering" = any extra with category 'food' or 'drinks'.
 * These items need to be ordered from the supplier (Pure Boats) by email.
 */

export interface ExtrasLineItem {
  name: string
  amount_cents: number
  category?: string
  extra_id?: string
  quantity?: number
}

export const CATERING_CATEGORIES = ['food'] as const

/**
 * Filter an extras_selected array down to catering items only.
 * Returns an empty array for null / undefined / non-array input.
 */
export function filterCateringItems(
  extras: ExtrasLineItem[] | null | undefined,
): ExtrasLineItem[] {
  if (!extras || !Array.isArray(extras)) return []
  return extras.filter(e => CATERING_CATEGORIES.includes(e.category as never))
}

/**
 * Return true when a booking has at least one catering item.
 */
export function hasCatering(extras: ExtrasLineItem[] | null | undefined): boolean {
  return filterCateringItems(extras).length > 0
}

/**
 * Sum the amount_cents of all catering items.
 */
export function cateringAmountCents(
  extras: ExtrasLineItem[] | null | undefined,
): number {
  return filterCateringItems(extras).reduce((sum, e) => sum + e.amount_cents, 0)
}
