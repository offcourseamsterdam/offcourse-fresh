import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { enforceRateLimit } from '@/lib/rate-limit'
import { validatePromoCode } from '@/lib/promo-codes/validate'
import { applyPromoCode } from '@/lib/promo-codes/apply'

/**
 * POST /api/promo/validate
 *
 * Public endpoint — called from checkout UI when user applies a promo code.
 * No auth required; the code itself is the secret.
 *
 * Body: { code: string, amountCents: number, baseAmountCents?, cityTaxCents?, listingId? }
 *
 * If baseAmountCents + cityTaxCents are provided, the discount is computed against
 * only `base + cityTax` (cruise only) so extras like unlimited drinks are unaffected
 * — matches partner deals where the cruise is gifted but extras are à la carte.
 *
 * Returns:
 *   ok:true  → { promoCodeId, discountType, discountAmountCents, label, newTotalCents, isFull }
 *   ok:false → { error: string }
 */
export async function POST(request: NextRequest) {
  // Codes are short and human-typeable, so they're brute-forceable without a
  // per-IP cap. 10/min is far above what a real customer retyping a code needs.
  const limited = enforceRateLimit(request, 'promo-validate', 10, 60_000)
  if (limited) return limited

  try {
    const { code, amountCents, baseAmountCents, cityTaxCents, listingId } = await request.json()

    if (!code || typeof code !== 'string') {
      return apiError('code is required', 400)
    }
    if (typeof amountCents !== 'number' || amountCents < 0) {
      return apiError('amountCents must be a non-negative number', 400)
    }

    // Pass listingId so scoped codes (those tied to a campaign) are rejected
    // when the customer is trying to use them on the wrong cruise.
    const validation = await validatePromoCode(code, {
      listingId: typeof listingId === 'string' ? listingId : null,
    })
    if (!validation.ok) {
      return apiError(validation.message, 422)
    }

    // Discountable base depends on the code's discount_scope:
    //   'cruise' → base + city tax only (extras excluded)
    //   'all'    → grand total (amountCents — extras included)
    // Falls back to amountCents when the breakdown isn't provided (back-compat).
    const hasBreakdown =
      typeof baseAmountCents === 'number' && typeof cityTaxCents === 'number'
    const discountableBase = hasBreakdown && validation.code.discount_scope === 'cruise'
      ? baseAmountCents + cityTaxCents
      : undefined  // undefined → applyPromoCode uses grandTotal (covers 'all' scope)

    const { discountAmountCents, newTotalCents, isFull } = applyPromoCode(
      validation.code,
      amountCents,
      discountableBase,
    )

    return apiOk({
      promoCodeId: validation.code.id,
      label: validation.code.label,
      discountType: validation.code.discount_type,
      discountAmountCents,
      newTotalCents,
      isFull,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
