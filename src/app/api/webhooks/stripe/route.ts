import { NextRequest, NextResponse, after } from 'next/server'
import { getStripe } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { describeCustomerTypes } from '@/lib/fareharbor/customer-type-name'
import { sendConfirmationEmail } from '@/lib/booking/send-confirmation-email'
import { getExtrasFromQuote, parseMetaCents } from '@/lib/booking/pi-metadata'
import { resolveCampaignCommission } from '@/lib/booking/campaign-commission'
import { buildFhBookingPlan } from '@/lib/booking/finalize-booking'
import { notifyCateringOrder } from '@/lib/catering/notify'
import { hasFood, type ExtrasLineItem } from '@/lib/catering/filter'
import { isWithinCateringAutoSendWindow } from '@/lib/catering/auto-send-cutoff'
import { sendCateringOrderEmailForBooking } from '@/lib/catering/send-catering-email'
import { extractVat } from '@/lib/extras/calculate'
import { CRUISE_VAT_RATE, EXTRAS_VAT_RATE } from '@/lib/booking/constants'
import { reportBookingConversion } from '@/lib/google-ads/report-conversion'
import { reportRefundAdjustment } from '@/lib/google-ads/report-refund'
import { postSlackText, postSlackCritical } from '@/lib/slack/send-notification'
import { notifyBookingsChanged } from '@/lib/realtime/notify-bookings-changed'
import { resolvePaymentMethodLabel } from '@/lib/stripe/payment-method-label'
import { resolveStripeFeeCents } from '@/lib/stripe/fee'
import { stripeWebhookSecret } from '@/lib/stripe/keys'
import { formatAmsterdamTime } from '@/lib/utils'
import { logWebhookEvent } from '@/lib/webhooks/log'
import { emitOpsEvent } from '@/lib/ops/events'
import { draftGuestMoveForNewBooking } from '@/lib/ghost/guest-move-drafter'
import type Stripe from 'stripe'

// The payment_intent.succeeded handler may spend up to ~40s retrying a transient
// FareHarbor failure before parking the booking. Keep the function timeout well
// above that so a retry sequence is never killed mid-flight.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const stripe = getStripe()
  const body = await request.text()
  const sig = request.headers.get('stripe-signature') ?? ''
  const webhookSecret = stripeWebhookSecret
  if (!webhookSecret) {
    console.error('[stripe-webhook] webhook secret not set (STRIPE_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET_TEST)')
    return NextResponse.json({ error: 'Misconfigured' }, { status: 500 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Durable audit/replay breadcrumb. Best-effort — never blocks event handling.
  await logWebhookEvent(supabase, {
    source: 'stripe',
    providerEventId: event.id,
    signatureValid: true,
    payload: event,
    processed: true,
  })

  // ── checkout.session.completed ────────────────────────────────────────────
  // Fires when a customer completes payment on a Stripe Checkout Session.
  // Used exclusively by our payment link flow (admin → "Betaallink aanmaken").
  //
  // The FareHarbor booking is already created at link-send time (to reserve the
  // slot). When the customer pays, we just flip the status + send a confirmation.
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session

    // Only handle our payment link bookings (other checkout sessions, if any, are skipped)
    if (session.metadata?.booking_source !== 'payment_link') {
      return NextResponse.json({ received: true })
    }

    // Look up the pre-created booking by Stripe session ID
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, status, booking_uuid, customer_name, customer_email, customer_phone, listing_title, booking_date, start_time, end_time, guest_count, base_amount_cents, category')
      .eq('stripe_session_id', session.id)
      .maybeSingle()

    if (!booking) {
      console.error('[stripe-webhook] checkout.session.completed: no booking found for session', session.id)
      return NextResponse.json({ received: true })
    }

    // Idempotency — Stripe retries for 72h on timeout; skip if already confirmed
    if (booking.status === 'confirmed') {
      console.log('[stripe-webhook] checkout.session.completed: already confirmed, skipping', session.id)
      return NextResponse.json({ received: true })
    }

    // Handle both string and expanded-object forms of payment_intent
    const piId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent as Stripe.PaymentIntent | null)?.id ?? null

    // Mark confirmed + store the underlying PaymentIntent ID (for refund tracking)
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'confirmed',
        payment_status: 'paid',
        stripe_amount: session.amount_total ?? undefined,
        ...(piId ? { stripe_payment_intent_id: piId } : {}),
      })
      .eq('id', booking.id)

    if (updateError) {
      console.error('[stripe-webhook] checkout.session.completed: DB update failed', updateError)
      // Alert Slack — customer paid but booking stays pending in admin dashboard
      await postSlackText([
        '🚨 *CRITICAL: PAYMENT LINK BOOKING DB FAILED* 🚨',
        '_Customer paid but booking status could not be confirmed in database._',
        `Session: \`${session.id}\`${piId ? `  ·  PI: \`${piId}\`` : ''}`,
        `Customer: ${booking.customer_name} · ${booking.customer_email}`,
        `Cruise: ${booking.listing_title}  ·  Date: ${booking.booking_date ?? '—'}`,
        '_Manually flip status to confirmed in Supabase and verify FareHarbor._',
      ].join('\n'))
      // Still send confirmation email — customer paid and needs their booking details
    } else {
      await notifyBookingsChanged()
      await emitOpsEvent({
        eventType: 'booking_confirmed',
        actorType: 'system',
        bookingId: booking.id,
        source: 'webhooks/stripe:checkout.session.completed',
        payload: { category: booking.category, guest_count: booking.guest_count, booking_date: booking.booking_date },
      })
      // Off the response path: does this new booking reveal a gap-closing
      // guest-move opportunity today? (Beer 2026-07-04 — every new booking
      // checks its own date immediately, not just the nightly scan.)
      if (booking.booking_date) {
        after(() =>
          draftGuestMoveForNewBooking(booking.booking_date as string).catch(err =>
            console.error('[stripe-webhook] guest-move check failed:', err),
          ),
        )
      }
    }

    const guestCount = Number(booking.guest_count ?? 1)
    const startTime = formatAmsterdamTime(booking.start_time)
    const slackText = [
      `*Payment link booking confirmed!* 🎉`,
      `*${booking.listing_title}*`,
      `📅 ${booking.booking_date ?? '—'} · ${startTime}`,
      `👥 ${guestCount} guest${guestCount !== 1 ? 's' : ''}`,
      `💰 €${((session.amount_total ?? 0) / 100).toFixed(0)}`,
      `👤 ${booking.customer_name} · ${booking.customer_email}`,
      booking.booking_uuid ? `🎫 FH: ${booking.booking_uuid}` : '',
      piId ? `💳 PI: ${piId}` : '',
    ].filter(Boolean).join('\n')

    await Promise.allSettled([
      postSlackText(slackText),
      sendConfirmationEmail({
        contact: {
          name: booking.customer_name ?? '',
          email: booking.customer_email ?? '',
          phone: booking.customer_phone ?? undefined,
        },
        listingTitle: booking.listing_title ?? '',
        date: booking.booking_date ?? '',
        startAt: booking.start_time || null,
        endAt: booking.end_time || null,
        guestCount,
        amountCents: session.amount_total ?? 0,
        extrasSelected: [],
        fhBookingUuid: booking.booking_uuid ?? undefined,
        category: booking.category ?? null,
        fareharborCustomerTypeRatePk: null,
      }),
    ])
  }

  // ── checkout.session.expired ──────────────────────────────────────────────
  // The 24h payment link expired without the customer paying.
  // The FH slot was pre-booked — we must cancel it to release capacity.
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session

    if (session.metadata?.booking_source !== 'payment_link') {
      return NextResponse.json({ received: true })
    }

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_uuid, customer_name, listing_title')
      .eq('stripe_session_id', session.id)
      .maybeSingle()

    if (!booking) {
      return NextResponse.json({ received: true })
    }

    // Cancel the pre-booked FH slot so capacity is released
    if (booking.booking_uuid) {
      const fh = getFareHarborClient()
      try {
        await fh.cancelBooking(booking.booking_uuid)
      } catch (err) {
        console.error('[stripe-webhook] checkout.session.expired: FH cancel failed', err)
      }
    }

    // Mark cancelled in Supabase
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ status: 'cancelled', payment_status: 'expired' })
      .eq('id', booking.id)

    if (updateError) {
      console.error('[stripe-webhook] checkout.session.expired: DB update failed', updateError)
    } else {
      await notifyBookingsChanged()
    }

    await postSlackText([
      `⏰ *Payment link expired — FH slot released*`,
      `${booking.listing_title}`,
      `👤 ${booking.customer_name}`,
      booking.booking_uuid ? `FH cancelled: ${booking.booking_uuid}` : '',
    ].filter(Boolean).join('\n'))
  }

  // ── payment_intent.succeeded ──────────────────────────────────────────────
  // THE single finalizer. For every website payment (card or iDEAL) this is the
  // only place a FareHarbor booking is created — the browser no longer books, it
  // just polls the confirmation page.
  //
  // Write-row-first: we insert the bookings row at status 'paid_pending_fh' the
  // instant payment succeeds. The UNIQUE(stripe_payment_intent_id) constraint
  // (migration 052) is the exactly-once gate — a duplicate Stripe delivery loses
  // the INSERT (23505) and exits before touching FareHarbor (this replaces the
  // old claim mutex). We then create the FareHarbor booking (idempotent + retry
  // on transient errors) and flip the row to 'confirmed'. On hard failure we
  // PARK the row (keep the money, alert a human, let the pending-fh-sweep cron
  // retry) — we NEVER auto-refund.
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const meta = pi.metadata ?? {}

    // Payment link bookings are handled in checkout.session.completed above.
    if (meta.booking_source === 'payment_link') {
      return NextResponse.json({ received: true })
    }

    // Google Ads conversion — fires once per successful payment (own dedupe).
    // Reported on the real payment regardless of booking outcome; a later
    // deliberate refund retracts it via charge.refunded.
    try {
      await reportBookingConversion({ supabase, pi })
    } catch (err) {
      console.error('[stripe-webhook] reportBookingConversion error (ignored):', err)
    }

    // Refund guard: never (re)book a payment that has already been refunded.
    try {
      const refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 1 })
      if (refunds.data.length > 0) {
        console.log('[stripe-webhook] PI already refunded — not booking:', pi.id)
        return NextResponse.json({ received: true })
      }
    } catch {
      // A refund-lookup failure must not block a legitimate booking — proceed.
    }

    console.log('[stripe-webhook] payment_intent.succeeded — finalizing PI:', pi.id)

    const extrasSelected = await getExtrasFromQuote(meta.quote_id)
    const guestCount = Number(meta.guest_count ?? 1)
    const serverBaseAmount = Number(meta.server_base_amount_cents ?? 0)
    const extrasAmountCents = Number(meta.extras_amount_cents ?? 0)
    // VAT fields may be absent from PI metadata; fall back to server-side compute
    // (9% base, 21% extras). parseMetaCents keeps an explicit "0" as a real zero.
    const baseVatAmountCents = parseMetaCents(meta.base_vat_amount_cents) ?? extractVat(serverBaseAmount, CRUISE_VAT_RATE)
    const extrasVatAmountCents = parseMetaCents(meta.extras_vat_amount_cents) ?? extractVat(extrasAmountCents, EXTRAS_VAT_RATE)
    const totalVatAmountCents = parseMetaCents(meta.total_vat_amount_cents) ?? (baseVatAmountCents + extrasVatAmountCents)

    // Partner/campaign attribution — resolved server-side at create-intent time
    // (from the oc_attr cookie, which the webhook can never read directly) and
    // carried here via PI metadata. Re-verified against the campaigns table
    // rather than trusted blindly: the attribution cookie can outlive the
    // campaign (customer books days after clicking; an admin deletes the
    // campaign in between), and bookings.campaign_id/partner_id are real FKs —
    // inserting a stale id would reject the ENTIRE paid booking. Shared with
    // the admin /book route's own campaign lookups (src/lib/booking/campaign-commission.ts).
    let campaignId: string | null = null
    let partnerId: string | null = null
    let commissionAmountCents: number | null = null
    if (meta.campaign_id) {
      const resolved = await resolveCampaignCommission(supabase, String(meta.campaign_id), serverBaseAmount)
      if (resolved) {
        campaignId = resolved.campaignId
        partnerId = resolved.partnerId
        commissionAmountCents = resolved.commissionAmountCents
      }
    }

    // 1. Write the row first — the UNIQUE PI constraint is the exactly-once gate.
    const { data: insertedBooking, error: insertError } = await supabase.from('bookings').insert({
      booking_id: pi.id,
      booking_uuid: null,
      fareharbor_availability_pk: Number(meta.avail_pk),
      fareharbor_customer_type_rate_pk: Number(meta.customer_type_rate_pk),
      customer_type_name: meta.customer_type_name || null,
      stripe_payment_intent_id: pi.id,
      stripe_amount: pi.amount,
      base_amount_cents: serverBaseAmount,
      base_vat_rate: CRUISE_VAT_RATE,
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
      status: 'paid_pending_fh',
      payment_status: 'paid',
      currency: 'eur',
      booking_source: 'website',
      session_id: meta.session_id || null,
      gclid: meta.gclid || null,
      traffic_source: meta.traffic_source || null,
      traffic_detail: meta.traffic_detail || null,
      campaign_id: campaignId,
      partner_id: partnerId,
      commission_amount_cents: commissionAmountCents,
      promo_code_id: meta.promo_code_id || null,
      discount_amount_cents: Number(meta.discount_amount_cents ?? 0),
    })
      .select('id')
      .single()

    if (insertError) {
      // 23505 → a duplicate Stripe delivery already owns this PI. Exit before any
      // FareHarbor call (this is the exactly-once gate that replaces the mutex).
      if (insertError.code === '23505') {
        console.log('[stripe-webhook] duplicate delivery for PI — already finalizing:', pi.id)
        return NextResponse.json({ received: true })
      }
      console.error('[stripe-webhook] booking row insert failed for PI', pi.id, insertError)
      await alertWebhookFailure(stripe, pi, `Booking row insert failed: ${insertError.message}`,
        '_The customer is charged but we could not record the payment. Investigate Supabase — do NOT refund without checking._')
      return NextResponse.json({ received: true })
    }

    // Row is now visible in the admin Bookings/Planning views (status: paid_pending_fh) —
    // ping any open page to refetch. Covers both outcomes below (confirmed or parked)
    // with one call, since the row is already there either way. Awaited (not
    // fire-and-forget) — an un-awaited promise risks never completing before a
    // serverless function tears down.
    await notifyBookingsChanged()

    // 2. We own the row — create the FareHarbor booking (idempotent + retry).
    //    The booking body (incl. shared adult/child rate splits + the voucher tag) is
    //    built by the shared core so the webhook and the sweep cron can't drift.
    const fh = getFareHarborClient()
    const { availPk, date: bookingDate, body: bookingBody } =
      buildFhBookingPlan(pi, (extrasSelected ?? []) as unknown as ExtrasLineItem[])

    let fhBookingUuid: string | undefined
    try {
      const booking = await fh.createBookingIdempotent(availPk, bookingBody, bookingDate)
      fhBookingUuid = booking?.uuid
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // PARK — keep the money, alert a human, NEVER refund. The row stays
      // 'paid_pending_fh' and the pending-fh-sweep cron retries it shortly.
      console.error('[stripe-webhook] FareHarbor booking failed — parking PI:', pi.id, msg)
      await alertWebhookFailure(stripe, pi, `FareHarbor booking failed: ${msg}`,
        '_Payment is captured; the booking is PARKED (paid_pending_fh). Create the FareHarbor booking manually and flip the row to confirmed — do NOT refund._')
      return NextResponse.json({ received: true })
    }

    // 3. Booked — flip the row to confirmed. Retry the DB write a few times: the
    // FareHarbor booking already EXISTS, so a transient DB blip must not strand the
    // row at paid_pending_fh (which would make the sweep create a second booking).
    let updateError: { message: string } | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'confirmed', booking_uuid: fhBookingUuid ?? null })
        .eq('stripe_payment_intent_id', pi.id)
      updateError = error
      if (!updateError) break
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
    }

    if (updateError) {
      console.error('[stripe-webhook] confirmed-flip failed for PI', pi.id, updateError)
      await alertWebhookFailure(stripe, pi, `FareHarbor booked (${fhBookingUuid}) but the confirmed-flip failed: ${updateError.message}`,
        `_The FareHarbor booking EXISTS (\`${fhBookingUuid}\`). Flip the row to confirmed in Supabase — do NOT recreate or refund._`)
      // Don't return — still notify; the cruise IS booked.
    } else {
      // Status just changed paid_pending_fh → confirmed — that's visible on the
      // admin views (status badge), so ping again.
      await notifyBookingsChanged()
      await emitOpsEvent({
        eventType: 'booking_confirmed',
        actorType: 'system',
        bookingId: insertedBooking?.id,
        source: 'webhooks/stripe:payment_intent.succeeded',
        payload: {
          stripe_payment_intent_id: pi.id,
          category: meta.category,
          guest_count: guestCount,
          booking_date: meta.date,
        },
      })
      // Off the response path: does this new booking reveal a gap-closing
      // guest-move opportunity today?
      if (meta.date) {
        after(() =>
          draftGuestMoveForNewBooking(meta.date as string).catch(err =>
            console.error('[stripe-webhook] guest-move check failed:', err),
          ),
        )
      }
    }

    const startTime = formatAmsterdamTime(meta.start_at)
    const endTime = formatAmsterdamTime(meta.end_at)
    // The method actually USED lives on the charge (pi.payment_method_types is the
    // static list we OFFERED — always card/ideal/link — so it can't tell card from
    // iDEAL). Look it up best-effort; never block the booking on it.
    const paymentMethodLabel = await resolvePaymentMethodLabel(stripe, pi)
    // Stripe's own processing fee — lives on the charge's balance_transaction, not
    // the PI. Best-effort, for the admin Finance/VAT reconciliation view only;
    // never blocks or fails the booking.
    const stripeFeeCents = await resolveStripeFeeCents(stripe, pi)
    if (stripeFeeCents != null) {
      try {
        // supabase-js doesn't throw on a DB-level failure — it returns
        // { error } — so this must be checked explicitly, not just wrapped
        // in try/catch, or a real write failure (RLS, constraint) would be
        // silently ignored despite the catch block implying it's logged.
        const { error: feeUpdateError } = await supabase
          .from('bookings')
          .update({ stripe_fee_cents: stripeFeeCents })
          .eq('stripe_payment_intent_id', pi.id)
        if (feeUpdateError) {
          console.error('[stripe-webhook] stripe_fee_cents update failed (ignored):', pi.id, feeUpdateError.message)
        }
      } catch (err) {
        console.error('[stripe-webhook] stripe_fee_cents update failed (ignored):', pi.id, err)
      }
    }
    // Selected FareHarbor customer type for the Slack alert (best-effort, cached lookup).
    const customerTypesLabel = await describeCustomerTypes(Number(meta.avail_pk), {
      customerTypeRatePk: meta.customer_type_rate_pk ? Number(meta.customer_type_rate_pk) : null,
    })
    const slackText = [
      `*New booking confirmed!* 🎉 _(${paymentMethodLabel} — via webhook)_`,
      `*${meta.listing_title}*`,
      `📅 ${meta.date} · ${startTime} – ${endTime}`,
      `👥 ${guestCount} guest${guestCount !== 1 ? 's' : ''} · ${meta.category}`,
      customerTypesLabel ? `⛵ Type: ${customerTypesLabel}` : '',
      `💰 €${(pi.amount / 100).toFixed(0)}`,
      `👤 ${meta.guest_name} · ${meta.guest_email}`,
      fhBookingUuid ? `🎫 FH: ${fhBookingUuid}` : '',
      `💳 PI: ${pi.id}`,
    ].filter(Boolean).join('\n')

    // Catering already inside the 7-day auto-send window at booking time (e.g. a
    // last-minute booking) gets its supplier email sent instantly here, instead of
    // waiting for the daily cron. Bookings further out stay queued — the cron picks
    // them up the day they cross the 7-day mark.
    const insertedBookingId = insertedBooking?.id ?? null
    const shouldAutoSendCateringNow =
      insertedBookingId !== null &&
      hasFood((extrasSelected ?? []) as never) &&
      isWithinCateringAutoSendWindow(meta.date ?? null)

    // Slack + email + catering fire concurrently (all best-effort side channels)
    await Promise.allSettled([
      postSlackText(slackText),
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
        stripePaymentIntentId: pi.id,
        baseAmountCents: serverBaseAmount || null,
        discountAmountCents: Number(meta.discount_amount_cents ?? 0),
      }),
      notifyCateringOrder({
        cruiseName: meta.listing_title ?? '',
        dateStr: meta.date ?? null,
        startTimeStr: meta.start_at || null,
        guestCount,
        extrasSelected,
      }),
      ...(shouldAutoSendCateringNow && insertedBookingId ? [sendCateringOrderEmailForBooking(insertedBookingId)] : []),
    ])
  }

  // ── charge.refunded ────────────────────────────────────────────────────────
  // Fired when a refund is issued (partial or full) via the Stripe dashboard.
  // Update the booking's payment_status in Supabase + post a Slack note.
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge
    const piId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : (charge.payment_intent as Stripe.PaymentIntent | null)?.id ?? null
    if (piId) {
      const refundedCents = charge.amount_refunded
      const isFullRefund = refundedCents >= charge.amount

      await supabase
        .from('bookings')
        .update({ payment_status: isFullRefund ? 'refunded' : 'partially_refunded' })
        .eq('stripe_payment_intent_id', piId)
      await notifyBookingsChanged()

      // Google Ads: retract (full) or restate (partial) the conversion so
      // reported revenue stays honest. No-op if we never reported this one.
      try {
        await reportRefundAdjustment({
          supabase,
          paymentIntentId: piId,
          isFullRefund,
          refundedCents,
          chargeAmountCents: charge.amount,
        })
      } catch (err) {
        console.error('[stripe-webhook] reportRefundAdjustment error (ignored):', err)
      }

      await postSlackText([
        isFullRefund ? '↩️ *Full refund issued*' : '↩️ *Partial refund issued*',
        `Amount refunded: €${(refundedCents / 100).toFixed(2)}`,
        `PI: \`${piId}\``,
      ].join('\n'))
    }
  }

  // ── charge.dispute.created ─────────────────────────────────────────────────
  // A customer opened a chargeback. Respond within 7 days or we auto-lose.
  // Send an urgent Slack alert immediately.
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute
    const chargeId = typeof dispute.charge === 'string' ? dispute.charge : (dispute.charge as Stripe.Charge)?.id

    await postSlackText([
      '🚨 *CHARGEBACK OPENED* 🚨',
      '_A customer disputed a charge. Respond in Stripe within 7 days to avoid auto-losing._',
      '',
      `Amount: €${(dispute.amount / 100).toFixed(2)}`,
      `Reason: ${dispute.reason ?? 'unknown'}`,
      `Charge: \`${chargeId}\``,
      `Dispute: \`${dispute.id}\``,
      '',
      `https://dashboard.stripe.com/disputes/${dispute.id}`,
    ].join('\n'))
  }

  // ── payment_intent.payment_failed ──────────────────────────────────────────
  // Payment failed (card declined, iDEAL rejected by bank, etc.). The customer
  // sees the error in their browser, so no customer action needed — just log to
  // Slack for visibility on failed attempts.
  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent
    const meta = pi.metadata ?? {}
    const failureMsg = pi.last_payment_error?.message ?? 'unknown reason'

    await postSlackText([
      `💳 *Payment failed* — €${(pi.amount / 100).toFixed(0)}`,
      `Reason: ${failureMsg}`,
      meta.listing_title ? `Cruise: ${meta.listing_title}` : '',
      meta.guest_name ? `Guest: ${meta.guest_name} · ${meta.guest_email}` : '',
      `PI: \`${pi.id}\``,
    ].filter(Boolean).join('\n'))
  }

  return NextResponse.json({ received: true })
}

/**
 * Alert Slack when the webhook can't complete a booking for a paid PI.
 * Critical — Stripe confirmed the money, but FareHarbor or Supabase failed.
 *
 * The customer's *actual* payment method is derived from the charge (never
 * hardcoded), so the alert no longer claims "iDEAL/async" for a card/Link pay.
 */
async function alertWebhookFailure(
  stripe: Stripe,
  pi: Stripe.PaymentIntent,
  reason: string,
  actionLine?: string,
) {
  const meta = pi.metadata ?? {}
  const method = await resolvePaymentMethodLabel(stripe, pi).catch(() => 'online payment')

  const text = [
    '🚨 *CRITICAL: WEBHOOK BOOKING FAILED* 🚨',
    `_Customer paid (${method}) but the booking could not be completed._`,
    '',
    `*Reason:* \`${reason}\``,
    `*PI:* \`${pi.id}\`  ·  Amount: €${(pi.amount / 100).toFixed(0)}`,
    `*Customer:* ${meta.guest_name} · ${meta.guest_email} · ${meta.guest_phone}`,
    `*Cruise:* ${meta.listing_title}  ·  Date: ${meta.date}`,
    `*Avail PK:* ${meta.avail_pk}  ·  CT Rate PK:* ${meta.customer_type_rate_pk}`,
    '',
    actionLine ?? '_Manually create the FareHarbor booking and send a confirmation email._',
  ].join('\n')

  if (process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL) {
    await postSlackCritical(text)
  } else {
    console.error('[stripe-webhook] CRITICAL (no Slack configured):', text)
  }
}
