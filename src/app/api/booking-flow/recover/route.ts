import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { recoverBookingFromPi } from '@/lib/booking/recover-from-pi'
import { postSlackText } from '@/lib/slack/send-notification'

/**
 * POST /api/booking-flow/recover
 *
 * Browser-triggered recovery for iDEAL (and other redirect-based) payments
 * where sessionStorage was cleared during the cross-origin bank redirect.
 *
 * Called from CheckoutFlow when:
 *   1. URL contains ?redirect_status=succeeded&payment_intent=pi_xxx
 *   2. sessionStorage is empty (data lost during redirect)
 *
 * Reconstructs the booking from PI metadata + stored pricing_quotes row,
 * creates the FareHarbor booking (idempotent), saves to Supabase, sends the
 * confirmation email, and returns the listing slug so the browser can redirect
 * to /book/{slug}/confirmation.
 *
 * Public endpoint — the PI id is the authorization gate (only the payer has it).
 * Rate-limited by Stripe (PI retrieval) and idempotent (safe to call twice).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { paymentIntentId } = body

    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return apiError('Missing paymentIntentId', 400)
    }

    const result = await recoverBookingFromPi(paymentIntentId)

    // Payment still settling at the bank (iDEAL) — not a failure. The browser
    // sends the customer to the confirmation page, which polls until the
    // payment_intent.succeeded webhook creates the booking.
    if (result.outcome === 'processing') {
      console.log('[recover] PI still processing, deferring to webhook:', paymentIntentId)
      return apiOk({
        listingSlug: result.listingSlug,
        fhBookingUuid: null,
        outcome: 'processing',
      })
    }

    if (!result.ok) {
      console.error('[recover] failed for PI', paymentIntentId, result.error)
      // A customer PAID and the browser-side recovery couldn't complete the
      // booking. The webhook safety net will retry (and auto-refund if it also
      // fails) — but ops must see this immediately, not find out from the customer.
      await postSlackText([
        '⚠️ *Browser-side iDEAL recovery failed*',
        `PI: \`${paymentIntentId}\``,
        `Reason: ${result.error ?? 'unknown'}`,
        '_The Stripe webhook will retry this booking (and auto-refund if it also fails). Watch for its alert._',
      ].join('\n'))
      return apiError(result.error ?? 'Recovery failed', 500)
    }

    console.log('[recover] outcome:', result.outcome, '| PI:', paymentIntentId, '| slug:', result.listingSlug)

    return apiOk({
      listingSlug: result.listingSlug,
      fhBookingUuid: result.fhBookingUuid,
      outcome: result.outcome,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[recover] unexpected error:', message)
    return apiError(message)
  }
}
