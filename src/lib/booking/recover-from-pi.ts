/**
 * recover-from-pi.ts
 *
 * Shared recovery logic for iDEAL (and other redirect-based) payments where the
 * browser-side booking flow failed after the bank redirect (e.g. sessionStorage
 * was cleared during the cross-origin redirect).
 *
 * Called from:
 *   - POST /api/booking-flow/recover   (browser-triggered, returns listingSlug)
 *   - POST /api/webhooks/stripe        (Stripe-triggered safety net)
 *
 * Idempotent: if a booking already exists for the PI, returns it immediately.
 */

import { getStripe } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { sendConfirmationEmail } from '@/lib/booking/send-confirmation-email'
import { notifyCateringOrder } from '@/lib/catering/notify'
import { extractVat } from '@/lib/extras/calculate'
import type Stripe from 'stripe'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecoveryResult {
  /** True when a booking was found or successfully created. */
  ok: boolean
  /** The listing slug — used by the browser to redirect to /book/{slug}/confirmation */
  listingSlug: string | null
  /** The FH booking UUID, if created or found. */
  fhBookingUuid: string | null | undefined
  /** 'existing' = idempotent hit; 'created' = newly created; 'failed' = error */
  outcome: 'existing' | 'created' | 'failed'
  error?: string
}

type ExtraLineItem = {
  name: string
  amount_cents: number
  category?: string
  extra_id?: string
  quantity?: number
  is_per_person_pick?: boolean
  vat_rate?: number
  vat_amount_cents?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch extras line items from the stored quote breakdown (same logic as webhook). */
async function getExtrasFromQuote(quoteId: string | undefined): Promise<ExtraLineItem[]> {
  if (!quoteId) return []
  try {
    const supabase = createAdminClient()
    const { data: quoteRow } = await supabase
      .from('pricing_quotes')
      .select('breakdown')
      .eq('id', quoteId)
      .maybeSingle()

    if (!quoteRow?.breakdown) return []

    type Breakdown = {
      extrasCalculation?: {
        line_items?: Array<{
          name?: string
          amount_cents?: number
          category?: string
          extra_id?: string
          quantity?: number
          is_per_person_pick?: boolean
          vat_rate?: number
          vat_amount_cents?: number
        }>
      }
    }
    const bd = quoteRow.breakdown as Breakdown
    return (bd.extrasCalculation?.line_items ?? [])
      .filter(li => Boolean(li.name) && typeof li.amount_cents === 'number' && li.amount_cents > 0)
      .map(li => ({
        name: li.name!,
        amount_cents: li.amount_cents!,
        ...(li.category ? { category: li.category } : {}),
        ...(li.extra_id ? { extra_id: li.extra_id } : {}),
        ...(li.quantity != null ? { quantity: li.quantity } : {}),
        ...(li.is_per_person_pick ? { is_per_person_pick: true } : {}),
        ...(li.vat_rate != null ? { vat_rate: li.vat_rate } : {}),
        ...(li.vat_amount_cents != null ? { vat_amount_cents: li.vat_amount_cents } : {}),
      }))
  } catch {
    return []
  }
}

/** Fetch the cruise listing slug from Supabase by listing_id. */
async function getListingSlug(listingId: string | undefined): Promise<string | null> {
  if (!listingId) return null
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('cruise_listings')
      .select('slug')
      .eq('id', listingId)
      .maybeSingle()
    return data?.slug ?? null
  } catch {
    return null
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Recover a booking for a succeeded PaymentIntent.
 *
 * Pass either a pre-fetched PI object (webhook path, no extra Stripe call) or
 * a PI id string (browser path — we fetch it from Stripe inside).
 */
export async function recoverBookingFromPi(
  piOrId: Stripe.PaymentIntent | string,
): Promise<RecoveryResult> {
  const stripe = getStripe()
  const supabase = createAdminClient()

  // 1. Resolve the PaymentIntent
  let pi: Stripe.PaymentIntent
  try {
    pi = typeof piOrId === 'string'
      ? await stripe.paymentIntents.retrieve(piOrId)
      : piOrId
  } catch (err) {
    return { ok: false, listingSlug: null, fhBookingUuid: null, outcome: 'failed', error: 'Could not retrieve payment' }
  }

  if (pi.status !== 'succeeded') {
    return { ok: false, listingSlug: null, fhBookingUuid: null, outcome: 'failed', error: `Payment not succeeded (status: ${pi.status})` }
  }

  const meta = pi.metadata ?? {}

  // 2. Idempotency — if already booked, return the existing record
  const { data: existing } = await supabase
    .from('bookings')
    .select('id, booking_uuid, listing_id')
    .eq('stripe_payment_intent_id', pi.id)
    .not('booking_date', 'is', null)   // skip FH-webhook skeleton rows
    .maybeSingle()

  if (existing) {
    const listingSlug = await getListingSlug(existing.listing_id ?? meta.listing_id)
    return {
      ok: true,
      listingSlug,
      fhBookingUuid: existing.booking_uuid,
      outcome: 'existing',
    }
  }

  // 3. Extras from quote
  const extrasSelected = await getExtrasFromQuote(meta.quote_id)

  // 4. Create FareHarbor booking
  const fh = getFareHarborClient()
  const isPrivate = meta.category === 'private'
  const guestCount = Number(meta.guest_count ?? 1)
  const customers = Array.from({ length: isPrivate ? 1 : guestCount }, () => ({
    customer_type_rate: Number(meta.customer_type_rate_pk),
  }))
  const bookingBody = {
    contact: {
      name: meta.guest_name ?? '',
      phone: meta.guest_phone ?? '',
      email: meta.guest_email ?? '',
    },
    customers,
  }

  let fhBookingUuid: string | undefined
  try {
    const validation = await fh.validateBooking(Number(meta.avail_pk), bookingBody)
    if (!validation.is_bookable) {
      return {
        ok: false, listingSlug: null, fhBookingUuid: null, outcome: 'failed',
        error: `FareHarbor validation failed: ${validation.error ?? 'unknown'}`,
      }
    }
    const booking = await fh.createBooking(Number(meta.avail_pk), bookingBody)
    fhBookingUuid = booking?.uuid
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, listingSlug: null, fhBookingUuid: null, outcome: 'failed', error: `FareHarbor error: ${msg}` }
  }

  // 5. Save to Supabase
  const serverBaseAmount = Number(meta.server_base_amount_cents ?? 0)
  const extrasAmountCents = Number(meta.extras_amount_cents ?? 0)
  const baseVatAmountCents = Number(meta.base_vat_amount_cents) || extractVat(serverBaseAmount, 9)
  const extrasVatAmountCents = Number(meta.extras_vat_amount_cents) || extractVat(extrasAmountCents, 21)
  const totalVatAmountCents = Number(meta.total_vat_amount_cents) || (baseVatAmountCents + extrasVatAmountCents)

  await supabase.from('bookings').insert({
    booking_id: pi.id,
    booking_uuid: fhBookingUuid ?? null,
    fareharbor_availability_pk: Number(meta.avail_pk),
    fareharbor_customer_type_rate_pk: Number(meta.customer_type_rate_pk),
    customer_type_name: meta.customer_type_name || null,
    stripe_payment_intent_id: pi.id,
    stripe_amount: pi.amount,
    base_amount_cents: serverBaseAmount,
    base_vat_rate: 9,
    base_vat_amount_cents: baseVatAmountCents,
    extras_amount_cents: extrasAmountCents,
    extras_vat_amount_cents: extrasVatAmountCents,
    total_vat_amount_cents: totalVatAmountCents,
    extras_selected: extrasSelected,
    listing_id: meta.listing_id || null,
    listing_title: meta.listing_title ?? '',
    category: meta.category ?? 'private',
    booking_date: meta.date || null,
    start_time: meta.start_at || null,
    end_time: meta.end_at || null,
    guest_count: guestCount,
    customer_name: meta.guest_name ?? '',
    customer_email: meta.guest_email ?? '',
    customer_phone: meta.guest_phone ?? '',
    status: 'confirmed',
    payment_status: 'paid',
    currency: 'eur',
    booking_source: 'website',
    session_id: meta.session_id || null,
    gclid: meta.gclid || null,
    promo_code_id: meta.promo_code_id || null,
    discount_amount_cents: Number(meta.discount_amount_cents ?? 0),
  })

  // 6. Confirmation email + catering (fire-and-forget; errors are non-fatal)
  await Promise.allSettled([
    sendConfirmationEmail({
      contact: {
        name: meta.guest_name ?? '',
        email: meta.guest_email ?? '',
        phone: meta.guest_phone,
      },
      listingTitle: meta.listing_title ?? '',
      date: meta.date ?? '',
      startAt: meta.start_at || null,
      endAt: meta.end_at || null,
      guestCount,
      amountCents: pi.amount,
      extrasSelected,
      fhBookingUuid,
      category: meta.category ?? null,
      fareharborCustomerTypeRatePk: meta.customer_type_rate_pk
        ? Number(meta.customer_type_rate_pk)
        : null,
    }),
    notifyCateringOrder({
      cruiseName: meta.listing_title ?? '',
      dateStr: meta.date ?? null,
      startTimeStr: meta.start_at || null,
      guestCount,
      extrasSelected: extrasSelected as never,
    }),
  ])

  // 7. Return slug for browser redirect
  const listingSlug = await getListingSlug(meta.listing_id)

  return { ok: true, listingSlug, fhBookingUuid, outcome: 'created' }
}
