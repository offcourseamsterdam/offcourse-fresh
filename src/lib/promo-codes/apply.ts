import type { PromoCodeRow } from './validate'

export interface DiscountResult {
  discountAmountCents: number
  newTotalCents: number
  /** True when the customer owes €0 after the discount and Stripe is bypassed.
   *  NOT just `discount_type === 'full'` — a "full" code with `discount_scope='cruise'`
   *  still leaves extras to pay, in which case the customer is charged via Stripe. */
  isFull: boolean
}

/**
 * Apply a promo code to a booking total.
 *
 * @param grandTotalCents       Full pre-discount total (cruise + city tax + extras).
 *                              Used to compute the post-discount newTotal.
 * @param discountableBaseCents Optional. The portion of the total that the promo applies to.
 *                              Defaults to grandTotalCents (legacy behaviour).
 *                              Pass `baseCruise + cityTax` (no extras) for partner-style codes
 *                              where extras like unlimited drinks must still be paid.
 */
export function applyPromoCode(
  code: PromoCodeRow,
  grandTotalCents: number,
  discountableBaseCents?: number,
): DiscountResult {
  // Discount is computed against the discountable base (which never exceeds the grand total).
  const base = Math.min(discountableBaseCents ?? grandTotalCents, grandTotalCents)
  let discountAmountCents: number

  switch (code.discount_type) {
    case 'percentage':
      discountAmountCents = Math.round(base * (code.discount_value ?? 0) / 100)
      break
    case 'fixed_amount':
      discountAmountCents = Math.min(code.fixed_discount_cents ?? 0, base)
      break
    case 'full':
      discountAmountCents = base
      break
    default:
      discountAmountCents = 0
  }

  const newTotalCents = Math.max(0, grandTotalCents - discountAmountCents)

  return {
    discountAmountCents,
    newTotalCents,
    isFull: newTotalCents === 0,
  }
}
