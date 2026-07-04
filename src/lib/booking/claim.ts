import type { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/supabase/types'

type AdminClient = ReturnType<typeof createAdminClient>
export type BookingInsert = Database['public']['Tables']['bookings']['Insert']

/**
 * Closing the FareHarbor double-create race.
 *
 * Two independent paths can try to turn one paid PaymentIntent into a booking:
 *   • the browser POST /api/booking-flow/book (card payments), and
 *   • the Stripe payment_intent.succeeded webhook (iDEAL/async + safety net).
 *
 * Historically both did: check-PI-exists → fh.createBooking → INSERT. The UNIQUE
 * constraint on bookings.stripe_payment_intent_id (migration 052) only fails the
 * SECOND insert — AFTER both have already called fh.createBooking. A lost race
 * therefore left an orphan FareHarbor booking (real capacity consumed) with no
 * Supabase row, invisible to every dashboard and to the fh-consistency cron.
 *
 * The fix: each path INSERTs the booking row in a `pending_payment` state BEFORE
 * touching FareHarbor. The unique constraint makes that insert the mutex —
 * exactly one path wins, the loser sees a 23505 and backs off WITHOUT calling
 * FareHarbor. The winner creates the FareHarbor booking, then `finalizeBooking`
 * promotes the row to `confirmed` with the real booking UUID.
 */

/**
 * Status a booking row sits in between "claimed" and "FareHarbor-confirmed".
 * It is deliberately a value that active-booking reads (which filter on
 * status in ('confirmed','booked')) exclude, so a claim never looks like a real
 * booking until finalizeBooking promotes it. `pending_payment` already exists in
 * the status vocabulary — no new enum value is introduced.
 */
export const CLAIM_STATUS = 'pending_payment'

/** Postgres unique_violation SQLSTATE — the claim lost the race for this PI. */
const UNIQUE_VIOLATION = '23505'

export type ClaimResult =
  | { outcome: 'won' }
  | { outcome: 'lost' }
  | { outcome: 'error'; error: string }

/**
 * Atomically claim a PaymentIntent by inserting its booking row in CLAIM_STATUS
 * with a null booking_uuid. `row.stripe_payment_intent_id` is the mutex key.
 *
 *   'won'   → this call created the row; proceed to create the FareHarbor booking.
 *   'lost'  → another path already owns this PaymentIntent; do NOT call FareHarbor.
 *   'error' → the claim insert failed for some other reason; fail safe (do NOT
 *             call FareHarbor — better an un-booked retry than an orphan booking).
 */
export async function claimBooking(supabase: AdminClient, row: BookingInsert): Promise<ClaimResult> {
  const { error } = await supabase
    .from('bookings')
    .insert({ ...row, status: CLAIM_STATUS, booking_uuid: null })

  if (!error) return { outcome: 'won' }
  if (error.code === UNIQUE_VIOLATION) return { outcome: 'lost' }
  return { outcome: 'error', error: error.message }
}

/**
 * Promote a claimed booking to `confirmed` (or a caller-supplied status) once
 * FareHarbor has created the booking. Matches on stripe_payment_intent_id, the
 * same key used to claim.
 */
export async function finalizeBooking(
  supabase: AdminClient,
  stripePaymentIntentId: string,
  patch: { bookingUuid: string | null; status?: string },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('bookings')
    .update({ booking_uuid: patch.bookingUuid, status: patch.status ?? 'confirmed' })
    .eq('stripe_payment_intent_id', stripePaymentIntentId)

  return error ? { ok: false, error: error.message } : { ok: true }
}

/**
 * Release a claim when FareHarbor creation fails after winning it — delete the
 * still-`pending_payment` row so a later retry (Stripe re-delivers the webhook
 * for up to 72h) can re-attempt cleanly instead of being permanently blocked by
 * our orphaned claim. The status guard ensures we never delete a finalized
 * booking, only one still in the claim state.
 */
export async function releaseClaim(supabase: AdminClient, stripePaymentIntentId: string): Promise<void> {
  await supabase
    .from('bookings')
    .delete()
    .eq('stripe_payment_intent_id', stripePaymentIntentId)
    .eq('status', CLAIM_STATUS)
}
