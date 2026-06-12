import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/booking-flow/confirmation-status?payment_intent=pi_xxx
 *
 * Polled by the confirmation page while it waits for a booking row to appear.
 * With iDEAL the customer can land on the confirmation page seconds before the
 * Stripe webhook has created the booking — the page polls this endpoint and
 * refreshes itself once the row exists.
 *
 * Returns only `{ found: boolean }` — never booking details — so polling with
 * a guessed PI id can't leak anything.
 */
export async function GET(request: NextRequest) {
  const paymentIntent = request.nextUrl.searchParams.get('payment_intent')

  if (!paymentIntent || !paymentIntent.startsWith('pi_')) {
    return apiError('Missing or invalid payment_intent', 400)
  }

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('bookings')
    .select('id')
    .eq('stripe_payment_intent_id', paymentIntent)
    .maybeSingle()

  return apiOk({ found: Boolean(data) })
}
