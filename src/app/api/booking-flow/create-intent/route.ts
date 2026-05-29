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
    const { quoteId, listingTitle, date, startAt, endAt, contact } = body

    if (!quoteId) {
      return apiError('Missing quoteId — please refresh your booking and try again.', 400)
    }
    if (!contact?.name || !contact?.email) {
      return apiError('Missing contact details', 400)
    }

    // Attribution + consent travel via first-party cookies (same pattern as
    // oc_attr in /book). The gclid becomes the Google Ads conversion key; the
    // consent flag gates whether the webhook may forward it to Google.
    const gclid = request.cookies.get('oc_gclid')?.value ?? null
    const clickType = request.cookies.get('oc_click_type')?.value ?? null
    const marketingConsent = request.cookies.get('oc_consent')?.value === 'yes'

    const result = await createPaymentIntent({
      quoteId: String(quoteId),
      listingTitle: String(listingTitle ?? ''),
      date: String(date ?? ''),
      startAt: startAt ?? null,
      endAt: endAt ?? null,
      contact,
      gclid,
      clickType,
      marketingConsent,
    })

    return apiOk(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[create-intent route] error', message)
    return apiError(message)
  }
}
