import type { PromoCodeRow } from './validate'

export interface DiscountResult {
  discountAmountCents: number
  newTotalCents: number
  isFull: boolean
}

export function applyPromoCode(code: PromoCodeRow, grandTotalCents: number): DiscountResult {
  let discountAmountCents: number

  switch (code.discount_type) {
    case 'percentage':
      discountAmountCents = Math.round(grandTotalCents * (code.discount_value ?? 0) / 100)
      break
    case 'fixed_amount':
      discountAmountCents = Math.min(code.fixed_discount_cents ?? 0, grandTotalCents)
      break
    case 'full':
      discountAmountCents = grandTotalCents
      break
    default:
      discountAmountCents = 0
  }

  const newTotalCents = Math.max(0, grandTotalCents - discountAmountCents)

  return {
    discountAmountCents,
    newTotalCents,
    isFull: code.discount_type === 'full',
  }
}
