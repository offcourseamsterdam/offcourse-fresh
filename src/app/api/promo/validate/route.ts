import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { validatePromoCode } from '@/lib/promo-codes/validate'
import { applyPromoCode } from '@/lib/promo-codes/apply'

/**
 * POST /api/promo/validate
 *
 * Public endpoint — called from checkout UI when user applies a promo code.
 * No auth required; the code itself is the secret.
 *
 * Body: { code: string, amountCents: number }
 *
 * Returns:
 *   ok:true  → { promoCodeId, discountType, discountAmountCents, label, newTotalCents, isFull }
 *   ok:false → { error: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { code, amountCents } = await request.json()

    if (!code || typeof code !== 'string') {
      return apiError('code is required', 400)
    }
    if (typeof amountCents !== 'number' || amountCents < 0) {
      return apiError('amountCents must be a non-negative number', 400)
    }

    const validation = await validatePromoCode(code)
    if (!validation.ok) {
      return apiError(validation.message, 422)
    }

    const { discountAmountCents, newTotalCents, isFull } = applyPromoCode(validation.code, amountCents)

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
