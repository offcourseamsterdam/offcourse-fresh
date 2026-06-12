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
import { postSlackText } from '@/lib/slack/send-notification'
import { extractVat } from '@/lib/extras/calculate'
import { formatAmsterdamTime } from '@/lib/utils'
import type Stripe from 'stripe'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecoveryResult {
  /** True when a booking was found or successfully created. */
  ok: boolean
  /** The listing slug — used by the browser to redirect to /book/{slug}/confirmation */
  listingSlug: string | null
  /** The FH booking UUID, if created or found. */
  fhBookingUuid: string | null | undefined
  /**
   * 'existing' = idempotent hit; 'created' = newly created; 'failed' = error;
   * 'processing' = payment still settling at the bank (iDEAL) — the webhook
   * will complete the booking once Stripe confirms, the browser should send
   * the customer to the confirmation page which polls until then.
   */
  outcome: 'existing' | 'created' | 'failed' | 'processing'
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

/**
 * Parse a cents amount from PI metadata (all metadata values are strings).
 * Returns null when the field is absent/empty/garbage so the caller can fall
 * back to a server-side computation — but, unlike `Number(x) || fallback`,
 * an explicit "0" is respected as a real zero.
 */
export function parseMetaCents(value: string | undefined): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Fetch extras line items from the stored quote breakdown. */
export async function getExtrasFromQuote(quoteId: string | undefined): Promise<ExtraLineItem[]> {
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
  } catch {
    return { ok: false, listingSlug: null, fhBookingUuid: null, outcome: 'failed', error: 'Could not retrieve payment' }
  }

  const meta = pi.metadata ?? {}

  if (pi.status === 'processing') {
    // iDEAL banks report "succeeded" to the browser before Stripe has settled
    // the payment. Not an error — the payment_intent.succeeded webhook will
    // create the booking shortly. Hand the slug back so the browser can park
    // the customer on the confirmation page, which polls until the row appears.
    const listingSlug = await getListingSlug(meta.listing_id)
    return { ok: false, listingSlug, fhBookingUuid: null, outcome: 'processing', error: 'Payment is still processing' }
  }

  if (pi.status !== 'succeeded') {
    return { ok: false, listingSlug: null, fhBookingUuid: null, outcome: 'failed', error: `Payment not succeeded (status: ${pi.status})` }
  }

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

  // 3. Refund guard — if this payment was already refunded (e.g. the webhook
  //    couldn't complete the booking and automatically returned the money),
  //    never create a booking for it.
  try {
    const refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 1 })
    if (refunds.data.length > 0) {
      return {
        ok: false, listingSlug: null, fhBookingUuid: null, outcome: 'failed',
        error: 'Payment was refunded — not creating a booking',
      }
    }
  } catch {
    // Refund lookup failing shouldn't block recovery — proceed.
  }

  // 3b. Extras from quote
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
  const baseVatAmountCents = parseMetaCents(meta.base_vat_amount_cents) ?? extractVat(serverBaseAmount, 9)
  const extrasVatAmountCents = parseMetaCents(meta.extras_vat_amount_cents) ?? extractVat(extrasAmountCents, 21)
  const totalVatAmountCents = parseMetaCents(meta.total_vat_amount_cents) ?? (baseVatAmountCents + extrasVatAmountCents)

  const { error: insertError } = await supabase.from('bookings').insert({
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
    traffic_source: meta.traffic_source || null,
    traffic_detail: meta.traffic_detail || null,
    promo_code_id: meta.promo_code_id || null,
    discount_amount_cents: Number(meta.discount_amount_cents ?? 0),
  })

  if (insertError) {
    if (insertError.code === '23505') {
      // Unique violation on stripe_payment_intent_id: another path (the Stripe
      // webhook, or the browser /book) saved this payment's booking while we
      // were creating ours. Ours is a duplicate — cancel it in FareHarbor so
      // the boat isn't blocked twice. The winning path sends the notifications.
      console.warn('[recover-from-pi] duplicate booking for PI', pi.id, '— cancelling our FH booking', fhBookingUuid)
      if (fhBookingUuid) {
        try {
          await fh.cancelBooking(fhBookingUuid)
        } catch (err) {
          await postSlackText([
            '🚨 *Duplicate FareHarbor booking could not be cancelled*',
            `Two booking paths raced for PI \`${pi.id}\`. The duplicate FH booking \`${fhBookingUuid}\` must be cancelled manually.`,
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ].join('\n'))
        }
      }
      const listingSlug = await getListingSlug(meta.listing_id)
      return { ok: true, listingSlug, fhBookingUuid: null, outcome: 'existing' }
    }
    // Any other insert failure: the FH booking exists and the email below will
    // still go out, but the row is missing from the admin dashboard — alert.
    console.error('[recover-from-pi] DB insert failed for PI', pi.id, insertError)
    await postSlackText([
      '🚨 *Booking created in FareHarbor but DB save failed (recovery path)*',
      `PI: \`${pi.id}\`  ·  FH: \`${fhBookingUuid ?? '—'}\``,
      `Customer: ${meta.guest_name} · ${meta.guest_email}`,
      `Error: ${insertError.message}`,
      '_Add the booking row manually in Supabase._',
    ].join('\n'))
  }

  // 6. Slack + confirmation email + catering (fire-and-forget; errors are non-fatal)
  const guestCountLabel = `${guestCount} guest${guestCount !== 1 ? 's' : ''}`
  await Promise.allSettled([
    postSlackText([
      `*New booking confirmed!* 🎉 _(iDEAL/async — via browser recovery)_`,
      `*${meta.listing_title}*`,
      `📅 ${meta.date} · ${formatAmsterdamTime(meta.start_at)} – ${formatAmsterdamTime(meta.end_at)}`,
      `👥 ${guestCountLabel} · ${meta.category}`,
      `💰 €${(pi.amount / 100).toFixed(0)}`,
      `👤 ${meta.guest_name} · ${meta.guest_email}`,
      fhBookingUuid ? `🎫 FH: ${fhBookingUuid}` : '',
      `💳 PI: ${pi.id}`,
    ].filter(Boolean).join('\n')),
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
      extrasSelected,
    }),
  ])

  // 7. Return slug for browser redirect
  const listingSlug = await getListingSlug(meta.listing_id)

  return { ok: true, listingSlug, fhBookingUuid, outcome: 'created' }
}
