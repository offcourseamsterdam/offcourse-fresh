import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { recoverBookingFromPi } from '@/lib/booking/recover-from-pi'

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

    if (!result.ok) {
      console.error('[recover] failed for PI', paymentIntentId, result.error)
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
