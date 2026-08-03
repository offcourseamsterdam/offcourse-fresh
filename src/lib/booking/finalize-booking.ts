/**
 * finalize-booking.ts
 *
 * The shared "booking core" used by BOTH the Stripe webhook (the finalizer) and the
 * pending-fh-sweep cron (the retry/safety net). Building the FareHarbor booking body
 * from PaymentIntent metadata — especially the customers array with shared adult/child
 * rate splits, and the voucher_number idempotency tag — lives in ONE place so the two
 * paths can never drift (a drift here is exactly the kind of money-path bug we've been
 * burned by before).
 */

import type Stripe from 'stripe'
import { buildFHBookingNote } from '@/lib/catering/build-fh-note'
import type { ExtrasLineItem } from '@/lib/catering/filter'
import type { FHBookingRequest } from '@/lib/fareharbor/types'

export interface FhBookingPlan {
  availPk: number
  /** Departure date (YYYY-MM-DD) — used to scope the idempotency lookup. */
  date: string
  body: FHBookingRequest
}

/**
 * Build the FareHarbor booking body from a PaymentIntent's metadata + the stored
 * extras. The `voucher_number` is the PaymentIntent id so a timed-out-but-succeeded
 * create can be found again instead of double-booked.
 */
export function buildFhBookingPlan(
  pi: Stripe.PaymentIntent,
  extrasSelected: ExtrasLineItem[],
): FhBookingPlan {
  const meta = pi.metadata ?? {}
  const isPrivate = meta.category === 'private'
  const guestCount = Number(meta.guest_count ?? 1)
  const storedRates = meta.customer_type_rates
    ? (JSON.parse(meta.customer_type_rates) as Array<{ pk: number; count: number }>)
    : null
  const multiRates = !isPrivate && storedRates && storedRates.length > 0
  const customers = multiRates
    ? storedRates.flatMap(({ pk, count }) =>
        Array.from({ length: count }, () => ({ customer_type_rate: Number(pk) })))
    : Array.from({ length: isPrivate ? 1 : guestCount }, () => ({
        customer_type_rate: Number(meta.customer_type_rate_pk),
      }))
  const fhNote = buildFHBookingNote(null, extrasSelected)
  return {
    availPk: Number(meta.avail_pk),
    date: meta.date ?? '',
    body: {
      contact: {
        name: meta.guest_name ?? '',
        phone: meta.guest_phone ?? '',
        email: meta.guest_email ?? '',
      },
      customers,
      voucher_number: pi.id,
      ...(fhNote ? { note: fhNote } : {}),
    },
  }
}
