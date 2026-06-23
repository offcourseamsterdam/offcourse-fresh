/**
 * booking-claims.ts
 *
 * An atomic mutex over a Stripe payment-intent id, used to guarantee that a single
 * payment produces at most ONE FareHarbor booking.
 *
 * The problem it solves: iDEAL (and other async Stripe methods) make two finalize
 * paths run concurrently for one payment — the browser /book call and the
 * payment_intent.succeeded webhook (plus the browser /recover fallback). All three
 * used to do check-then-act (SELECT bookings by PI → none → create FareHarbor
 * booking → INSERT). The bookings UNIQUE(stripe_payment_intent_id) constraint
 * caught the double INSERT, but only AFTER both had already created a FareHarbor
 * booking. By claiming the PI here BEFORE FareHarbor is ever called, only the
 * winner reaches FareHarbor; the losers never create a second booking.
 *
 * Mirrors the claim idioms already shipped in this codebase:
 *   - google_ads_conversions upsert/ignoreDuplicates  (report-conversion.ts)
 *   - pricing_quotes.consumed_at conditional update    (create-intent.ts)
 *
 * The claim is an OPTIMISATION layer, not the last line of defence: if it is
 * unavailable (e.g. the table is missing, or a transient DB error) the caller
 * proceeds anyway and the existing bookings unique constraint + the per-path
 * "cancel our FareHarbor booking on 23505" branches still prevent a double row.
 */

import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * 'won'        — we own the PI; proceed to create the FareHarbor booking. Release when done.
 * 'duplicate'  — a real bookings row already exists for this PI; return the existing booking.
 * 'in_flight'  — another live path holds the claim but hasn't inserted yet; do NOT call
 *                FareHarbor. Browser paths should let the confirmation page poll; the webhook
 *                should re-check after a short delay and take over if the owner stalled.
 * 'unavailable'— the claim layer itself failed (table missing / DB error). Treat like 'won'
 *                (proceed); the bookings unique constraint remains the backstop.
 */
export type ClaimOutcome = 'won' | 'duplicate' | 'in_flight' | 'unavailable'

// Happy path (claim → FareHarbor → insert) is ~1-2s. A claim older than this with
// no bookings row means the owning process crashed/timed out; the next attempt
// takes it over rather than waiting forever.
const STALE_CLAIM_MS = 90_000

async function tryInsertClaim(supabase: AdminClient, paymentIntentId: string) {
  // ON CONFLICT DO NOTHING → a returned row means we inserted (won); empty means
  // someone else holds the claim.
  return supabase
    .from('booking_claims')
    .upsert({ payment_intent_id: paymentIntentId }, { onConflict: 'payment_intent_id', ignoreDuplicates: true })
    .select('payment_intent_id')
}

/**
 * Attempt to claim a payment-intent id before creating a FareHarbor booking.
 * Never throws — any infrastructure failure resolves to 'unavailable' so the
 * booking flow degrades to its prior (constraint-backstopped) behaviour.
 */
export async function claimPaymentIntent(
  supabase: AdminClient,
  paymentIntentId: string,
): Promise<ClaimOutcome> {
  try {
    const { data: claimed, error } = await tryInsertClaim(supabase, paymentIntentId)
    if (error) {
      console.error('[booking-claims] claim failed for', paymentIntentId, error.message)
      return 'unavailable'
    }
    if (claimed && claimed.length > 0) return 'won'

    // Lost the claim — disambiguate the three losing cases.
    const { data: booking } = await supabase
      .from('bookings')
      .select('id')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .maybeSingle()
    if (booking) return 'duplicate'

    // No booking row yet: the owner is either still working or has crashed.
    const { data: claim } = await supabase
      .from('booking_claims')
      .select('created_at')
      .eq('payment_intent_id', paymentIntentId)
      .maybeSingle()

    const isStale = claim != null && Date.now() - new Date(claim.created_at).getTime() > STALE_CLAIM_MS
    if (isStale) {
      // Take over a crashed owner's slot: delete the stale claim and re-claim.
      await supabase.from('booking_claims').delete().eq('payment_intent_id', paymentIntentId)
      const { data: retry, error: retryError } = await tryInsertClaim(supabase, paymentIntentId)
      if (!retryError && retry && retry.length > 0) return 'won'
    }

    return 'in_flight'
  } catch (err) {
    console.error('[booking-claims] claim threw for', paymentIntentId, err)
    return 'unavailable'
  }
}

/**
 * Release a claim once the booking is fully resolved (saved, failed, or rolled back).
 * Safe to call unconditionally — a no-op if the row is already gone. Never throws.
 */
export async function releaseClaim(supabase: AdminClient, paymentIntentId: string): Promise<void> {
  try {
    await supabase.from('booking_claims').delete().eq('payment_intent_id', paymentIntentId)
  } catch (err) {
    console.error('[booking-claims] release failed for', paymentIntentId, err)
  }
}
