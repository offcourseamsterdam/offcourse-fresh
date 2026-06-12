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
  /** When true, `quantity` represents people-count for this item (e.g. Charcuterie
   *  for 4 people), not number of items. Renderers should show "for N people". */
  is_per_person_pick?: boolean
  /** 'extras_upsell' when added via the pre-cruise email upsell page (post-booking).
   *  Undefined for extras selected at checkout. */
  source?: string
}

export const CATERING_CATEGORIES = ['food', 'drinks'] as const

/**
 * Filter an extras_selected array down to catering items only (food + drinks).
 * Used by FH note builder and supplier email — not the admin list.
 */
export function filterCateringItems(
  extras: ExtrasLineItem[] | null | undefined,
): ExtrasLineItem[] {
  if (!extras || !Array.isArray(extras)) return []
  return extras.filter(e => CATERING_CATEGORIES.includes(e.category as never))
}

/** Return true when a booking has at least one food or drinks extra. */
export function hasCatering(extras: ExtrasLineItem[] | null | undefined): boolean {
  return filterCateringItems(extras).length > 0
}

/** Sum the amount_cents of all catering items (food + drinks). */
export function cateringAmountCents(
  extras: ExtrasLineItem[] | null | undefined,
): number {
  return filterCateringItems(extras).reduce((sum, e) => sum + e.amount_cents, 0)
}

// ── Food-only helpers (used by the Food Orders admin page) ──────────────────

/** Filter to food items only — excludes drinks. */
export function filterFoodItems(
  extras: ExtrasLineItem[] | null | undefined,
): ExtrasLineItem[] {
  if (!extras || !Array.isArray(extras)) return []
  return extras.filter(e => e.category === 'food')
}

/** Return true when a booking has at least one food item. */
export function hasFood(extras: ExtrasLineItem[] | null | undefined): boolean {
  return filterFoodItems(extras).length > 0
}

/** Sum the amount_cents of food items only. */
export function foodAmountCents(
  extras: ExtrasLineItem[] | null | undefined,
): number {
  return filterFoodItems(extras).reduce((sum, e) => sum + e.amount_cents, 0)
}
