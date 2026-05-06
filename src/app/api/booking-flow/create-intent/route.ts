import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createPaymentIntent } from '@/lib/booking/create-intent'

/**
 * POST /api/booking-flow/create-intent
 *
 * Creates a Stripe PaymentIntent against a server-issued price quote.
 * The browser must first call POST /api/booking-flow/quote to obtain a
 * quoteId — that quote's total is the canonical charge amount.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { quoteId, listingTitle, date, contact } = body

    if (!quoteId) {
      return apiError('Missing quoteId — please refresh your booking and try again.', 400)
    }
    if (!contact?.name || !contact?.email) {
      return apiError('Missing contact details', 400)
    }

    const result = await createPaymentIntent({
      quoteId: String(quoteId),
      listingTitle: String(listingTitle ?? ''),
      date: String(date ?? ''),
      contact,
    })

    return apiOk(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[create-intent route] error', message)
    return apiError(message)
  }
}
