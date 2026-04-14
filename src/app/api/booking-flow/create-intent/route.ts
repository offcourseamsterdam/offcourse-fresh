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
      durationMinutes = DEFAULT_DURATION_MINUTES,
    } = body

    if (baseAmountCents == null || !availPk || !customerTypeRatePk || !contact?.name || !contact?.email) {
      return apiError('Missing required fields', 400)
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
      durationMinutes: Number(durationMinutes),
    })

    return apiOk(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
