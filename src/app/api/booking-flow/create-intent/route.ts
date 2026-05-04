import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createPaymentIntent } from '@/lib/booking/create-intent'
import { DEFAULT_DURATION_MINUTES } from '@/lib/constants'

/**
 * POST /api/booking-flow/create-intent
 *
 * Public endpoint for creating a Stripe PaymentIntent.
 * Delegates to shared createPaymentIntent() which verifies price server-side.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      baseAmountCents, listingId, listingTitle,
      availPk, customerTypeRatePk, guestCount,
      category, date, contact,
      selectedExtraIds = [],
      extraQuantities = {},
      displayedExtrasAmountCents = 0,
      durationMinutes = DEFAULT_DURATION_MINUTES,
      promoCodeId,
      discountAmountCents,
    } = body

    if (baseAmountCents == null || !availPk || !customerTypeRatePk || !contact?.name || !contact?.email) {
      return apiError('Missing required fields', 400)
    }

    // Guard: if the checkout page showed extras but no IDs arrived, the session
    // is stale (JSON.stringify silently drops undefined). Fail loudly rather than
    // charging the wrong amount.
    if (displayedExtrasAmountCents > 0 && selectedExtraIds.length === 0) {
      return apiError(
        'Your session appears to be outdated. Please go back and re-select your extras before completing payment.',
        409,
      )
    }

    if (!Number.isFinite(Number(guestCount)) || Number(guestCount) < 1) {
      return apiError('guestCount must be a positive integer', 400)
    }

    const result = await createPaymentIntent({
      baseAmountCents: Number(baseAmountCents),
      listingId, listingTitle,
      availPk: Number(availPk),
      customerTypeRatePk: Number(customerTypeRatePk),
      guestCount: Number(guestCount),
      category, date, contact,
      selectedExtraIds,
      extraQuantities,
      durationMinutes: Number(durationMinutes),
      promoCodeId,
      discountAmountCents: discountAmountCents ? Number(discountAmountCents) : undefined,
    })

    return apiOk(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
