import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/server'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { buildFhBookingPlan } from '@/lib/booking/finalize-booking'
import { getExtrasFromQuote } from '@/lib/booking/pi-metadata'
import { sendConfirmationEmail } from '@/lib/booking/send-confirmation-email'
import { notifyCateringOrder } from '@/lib/catering/notify'
import { hasCatering, type ExtrasLineItem } from '@/lib/catering/filter'
import { isWithinCateringAutoSendWindow } from '@/lib/catering/auto-send-cutoff'
import { sendCateringOrderEmailForBooking } from '@/lib/catering/send-catering-email'
import { postSlackText, postSlackCritical } from '@/lib/slack/send-notification'
import { resolvePaymentMethodLabel } from '@/lib/stripe/payment-method-label'
import { formatAmsterdamTime } from '@/lib/utils'

// Booking creation can take a while (long FareHarbor timeout); give the sweep room.
export const maxDuration = 60

// A claim older than this is considered stuck (the previous run crashed mid-create)
// and is reclaimed. Normal completion takes seconds, and sweeps run 15 min apart.
const STALE_CLAIM_MS = 5 * 60 * 1000

// Escalate a still-unbooked paid row exactly once, in the 30–45 min age window
// (the cron runs every 15 min, so this fires ~one time per stuck booking).
const ESCALATE_MIN_MS = 30 * 60 * 1000
const ESCALATE_MAX_MS = 45 * 60 * 1000

/**
 * GET /api/cron/pending-fh-sweep — Vercel Cron, every 15 min.
 *
 * The safety net for the "park, never refund" model. Finds bookings the webhook
 * left at `paid_pending_fh` (FareHarbor failed at finalize time) and completes them:
 * claim the row, re-check it wasn't refunded, rebuild the booking from the
 * PaymentIntent (shared core), create it in FareHarbor (idempotent), flip to
 * `confirmed`, and send the confirmation email + catering the parked webhook skipped.
 * Never refunds.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  const supabase = createAdminClient()
  const stripe = getStripe()
  const fh = getFareHarborClient()

  const now = new Date()
  const nowIso = now.toISOString()
  const staleThreshold = new Date(now.getTime() - STALE_CLAIM_MS).toISOString()

  // Candidates: parked rows, plus any claim left stuck by a crashed earlier run.
  const { data: candidates, error } = await supabase
    .from('bookings')
    .select('id, status, stripe_payment_intent_id, created_at')
    .or(`status.eq.paid_pending_fh,and(status.eq.fh_in_progress,updated_at.lt.${staleThreshold})`)
    .not('stripe_payment_intent_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) {
    await postSlackCritical(`🚨 *pending-fh-sweep FAILED* — could not query Supabase: ${error.message}`)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ ok: true, swept: 0, completed: 0, cancelled: 0, failed: 0 })
  }

  const revert = (id: string) =>
    supabase.from('bookings').update({ status: 'paid_pending_fh', updated_at: nowIso }).eq('id', id)

  let completed = 0
  let cancelled = 0
  let failed = 0

  for (const cand of candidates) {
    if (!cand.status || !cand.stripe_payment_intent_id) continue
    const piId = cand.stripe_payment_intent_id

    // Atomic claim: flip to fh_in_progress only if the status is still what we read.
    // The loser of a race (sweep vs manual retry) gets no row back and steps aside.
    const { data: claimed } = await supabase
      .from('bookings')
      .update({ status: 'fh_in_progress', updated_at: nowIso })
      .eq('id', cand.id)
      .eq('status', cand.status)
      .select('id, stripe_payment_intent_id, created_at, extras_selected, customer_email, customer_name, customer_phone, listing_title, booking_date, start_time, end_time, guest_count, category, fareharbor_customer_type_rate_pk, base_amount_cents, discount_amount_cents, stripe_amount')
      .maybeSingle()
    if (!claimed) continue // someone else claimed it

    // Resolve the PaymentIntent — the source of truth for rebuilding the booking.
    let pi
    try {
      pi = await stripe.paymentIntents.retrieve(piId)
    } catch {
      await revert(claimed.id)
      failed++
      continue
    }

    // R4 — never book a payment a human already refunded. Re-check at completion time.
    try {
      const refunds = await stripe.refunds.list({ payment_intent: piId, limit: 1 })
      if (refunds.data.length > 0) {
        await supabase
          .from('bookings')
          .update({ status: 'cancelled', payment_status: 'refunded', updated_at: nowIso })
          .eq('id', claimed.id)
        await postSlackText(
          `↩️ *Parked booking cancelled — payment was refunded* (no FareHarbor booking created)\nPI: \`${piId}\` · ${claimed.customer_name ?? '?'} · ${claimed.listing_title ?? ''}`,
        )
        cancelled++
        continue
      }
    } catch {
      // A refund-lookup failure must not double-book — but also must not strand the
      // row. Proceed to book; the refund guard re-runs on the next sweep anyway.
    }

    // Rebuild the FareHarbor booking from the PI (shared core) + the stored extras.
    const quoteExtras = await getExtrasFromQuote(pi.metadata?.quote_id)
    const extras = (quoteExtras.length
      ? quoteExtras
      : (Array.isArray(claimed.extras_selected) ? claimed.extras_selected : [])) as ExtrasLineItem[]
    const plan = buildFhBookingPlan(pi, extras)

    let fhBookingUuid: string | undefined
    try {
      const booking = await fh.createBookingIdempotent(plan.availPk, plan.body, plan.date, { checkExisting: true })
      fhBookingUuid = booking?.uuid
    } catch (err) {
      await revert(claimed.id)
      failed++
      const ageMs = now.getTime() - new Date(claimed.created_at ?? nowIso).getTime()
      if (ageMs >= ESCALATE_MIN_MS && ageMs < ESCALATE_MAX_MS) {
        await postSlackCritical([
          '🔴 *PAID BUT UNBOOKED >30min* — the sweep still cannot book this paid cruise.',
          `*Reason:* \`${err instanceof Error ? err.message : String(err)}\``,
          `*PI:* \`${piId}\` · Amount: €${((claimed.stripe_amount ?? 0) / 100).toFixed(0)}`,
          `*Customer:* ${claimed.customer_name ?? '?'} · ${claimed.customer_email ?? '?'} · ${claimed.customer_phone ?? '?'}`,
          `*Cruise:* ${claimed.listing_title ?? ''} · ${claimed.booking_date ?? '?'}`,
          '_Create the FareHarbor booking manually and flip the row to confirmed — do NOT refund._',
        ].join('\n'))
      }
      continue
    }

    // Booked — flip to confirmed (atomic on our claim).
    await supabase
      .from('bookings')
      .update({ status: 'confirmed', booking_uuid: fhBookingUuid ?? null, updated_at: nowIso })
      .eq('id', claimed.id)

    // R6 — send the notifications the parked webhook never sent: email AND catering.
    const guestCount = Number(claimed.guest_count ?? 1)
    const paymentMethodLabel = await resolvePaymentMethodLabel(stripe, pi)
    // Catering already inside the 7-day auto-send window gets its supplier email
    // sent instantly here too — same rule as the webhook/admin paths.
    const shouldAutoSendCateringNow =
      hasCatering(extras) && isWithinCateringAutoSendWindow(claimed.booking_date ?? null)
    await Promise.allSettled([
      postSlackText([
        `*Parked booking completed by sweep!* 🎉 _(${paymentMethodLabel})_`,
        `*${claimed.listing_title ?? ''}*`,
        `📅 ${claimed.booking_date ?? '?'} · ${formatAmsterdamTime(claimed.start_time)} – ${formatAmsterdamTime(claimed.end_time)}`,
        `👥 ${guestCount} guest${guestCount !== 1 ? 's' : ''} · ${claimed.category ?? ''}`,
        fhBookingUuid ? `🎫 FH: ${fhBookingUuid}` : '',
        `💳 PI: ${piId}`,
      ].filter(Boolean).join('\n')),
      sendConfirmationEmail({
        contact: {
          name: claimed.customer_name ?? '',
          email: claimed.customer_email ?? '',
          phone: claimed.customer_phone ?? undefined,
        },
        listingTitle: claimed.listing_title ?? '',
        date: claimed.booking_date ?? '',
        startAt: claimed.start_time || null,
        endAt: claimed.end_time || null,
        guestCount,
        amountCents: claimed.stripe_amount ?? 0,
        extrasSelected: extras,
        fhBookingUuid,
        category: claimed.category ?? null,
        fareharborCustomerTypeRatePk: claimed.fareharbor_customer_type_rate_pk ?? null,
        stripePaymentIntentId: piId,
        baseAmountCents: claimed.base_amount_cents ?? null,
        discountAmountCents: claimed.discount_amount_cents ?? 0,
      }),
      notifyCateringOrder({
        cruiseName: claimed.listing_title ?? '',
        dateStr: claimed.booking_date ?? null,
        startTimeStr: claimed.start_time || null,
        guestCount,
        extrasSelected: extras,
      }),
      ...(shouldAutoSendCateringNow ? [sendCateringOrderEmailForBooking(claimed.id)] : []),
    ])
    completed++
  }

  return NextResponse.json({ ok: true, swept: candidates.length, completed, cancelled, failed })
}
