import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { sendConfirmationEmail } from '@/lib/booking/send-confirmation-email'
import { getExtrasFromQuote, parseMetaCents } from '@/lib/booking/recover-from-pi'
import { claimPaymentIntent, releaseClaim } from '@/lib/booking/booking-claims'
import { notifyCateringOrder } from '@/lib/catering/notify'
import { buildFHBookingNote } from '@/lib/catering/build-fh-note'
import type { ExtrasLineItem } from '@/lib/catering/filter'
import { extractVat } from '@/lib/extras/calculate'
import { reportBookingConversion } from '@/lib/google-ads/report-conversion'
import { reportRefundAdjustment } from '@/lib/google-ads/report-refund'
import { postSlackText } from '@/lib/slack/send-notification'
import { formatAmsterdamTime } from '@/lib/utils'
import type Stripe from 'stripe'

// The payment_intent.succeeded handler can sleep ~8s (see refundFailedBooking)
// before deciding to auto-refund. Raise the function timeout so that wait never
// kills the request mid-flight (Vercel default can be as low as 10s).
export const maxDuration = 60

// How long to wait before concluding "this paid customer truly has no booking".
// The browser-side /book or /recover may still be writing its row when this
// webhook fires; refunding during that window would refund a valid booking.
const BOOKING_RECHECK_DELAY_MS = 8000

export async function POST(request: NextRequest) {
  const stripe = getStripe()
  const body = await request.text()
  const sig = request.headers.get('stripe-signature') ?? ''
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set')
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
    }

    await postSlackText([
      `⏰ *Payment link expired — FH slot released*`,
      `${booking.listing_title}`,
      `👤 ${booking.customer_name}`,
      booking.booking_uuid ? `FH cancelled: ${booking.booking_uuid}` : '',
    ].filter(Boolean).join('\n'))
  }

  // ── payment_intent.succeeded ──────────────────────────────────────────────
  // Safety net for async payment methods (iDEAL, Bancontact, SEPA, etc.).
  //
  // Card payments confirm synchronously — the browser calls /book immediately
  // after Stripe.confirmPayment returns. But redirect-based methods (iDEAL)
  // send the user to their bank and back, and the browser-side flow can fail:
  //   • Race condition: handlePaymentSuccess ran while React state was null
  //   • Browser closed before returning from the bank
  //   • Network error after bank redirect
  //
  // When the browser flow fails, this webhook is the last line of defence.
  // It reads everything it needs from PI metadata + the stored pricing quote,
  // then creates the FareHarbor booking, saves to Supabase, and sends
  // the confirmation email and Slack notification — same as /book.
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const meta = pi.metadata ?? {}

    // Payment link bookings are handled in checkout.session.completed above.
    // The Checkout Session creates its own PI — if we don't skip here, the webhook
    // would try to create a second FareHarbor booking for the same slot.
    if (meta.booking_source === 'payment_link') {
      return NextResponse.json({ received: true })
    }

    // Google Ads conversion — report BEFORE the idempotency check below, because
    // that check early-returns for card payments already booked by /book, which
    // would otherwise skip the conversion (card is most revenue). This event
    // fires for EVERY successful payment, so it's the one reliable once-per-pay
    // hook. reportBookingConversion has its own dedupe and never throws; we still
    // wrap defensively so nothing here can break the booking flow below.
    try {
      await reportBookingConversion({ supabase, pi })
    } catch (err) {
      console.error('[stripe-webhook] reportBookingConversion error (ignored):', err)
    }

    // Idempotency — skip if the browser-side /book already ran.
    const { data: existingBooking } = await supabase
      .from('bookings')
      .select('id')
      .eq('stripe_payment_intent_id', pi.id)
      .maybeSingle()

    if (existingBooking) {
      console.log('[stripe-webhook] PI already processed by /book, skipping:', pi.id)
      return NextResponse.json({ received: true })
    }

    console.log('[stripe-webhook] payment_intent.succeeded — creating booking for PI:', pi.id)

    // Refund guard (mirrors /recover): never (re)book a payment that has already
    // been refunded — e.g. an earlier failed attempt auto-refunded it and Stripe
    // re-delivered this event.
    try {
      const refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 1 })
      if (refunds.data.length > 0) {
        console.log('[stripe-webhook] PI already refunded — not booking:', pi.id)
        return NextResponse.json({ received: true })
      }
    } catch {
      // A refund-lookup failure must not block a legitimate booking — proceed.
    }

    // Claim the PI BEFORE creating the FareHarbor booking so a racing browser
    // /book or /recover can never create a second booking. See booking-claims.ts.
    let claim = await claimPaymentIntent(supabase, pi.id)
    if (claim === 'duplicate') {
      console.log('[stripe-webhook] booking already exists for PI — skipping:', pi.id)
      return NextResponse.json({ received: true })
    }
    if (claim === 'in_flight') {
      // Another live path holds the claim but hasn't inserted yet. Wait the same
      // recheck window the refund path uses, then look again: if its booking
      // landed we're done; if it stalled (crashed mid-flight) we take over — the
      // bookings unique constraint + the 23505 branch below stay the final guard.
      await new Promise(resolve => setTimeout(resolve, BOOKING_RECHECK_DELAY_MS))
      const { data: landed } = await supabase
        .from('bookings')
        .select('id')
        .eq('stripe_payment_intent_id', pi.id)
        .maybeSingle()
      if (landed) {
        console.log('[stripe-webhook] booking completed by another path — skipping:', pi.id)
        return NextResponse.json({ received: true })
      }
      console.warn('[stripe-webhook] claim owner stalled — taking over PI:', pi.id)
      claim = 'won'
    }
    // 'won' → release the claim on every terminal below. 'unavailable' → claim
    // layer down; proceed anyway (the unique constraint is the backstop), nothing to release.
    const claimed = claim === 'won'

    // Retrieve extras line items from the stored quote breakdown.
    const extrasSelected = await getExtrasFromQuote(meta.quote_id)

    // Create the FareHarbor booking
    const fh = getFareHarborClient()
    const isPrivate = meta.category === 'private'
    const guestCount = Number(meta.guest_count ?? 1)
    const customers = Array.from({ length: isPrivate ? 1 : guestCount }, () => ({
      customer_type_rate: Number(meta.customer_type_rate_pk),
    }))
    const fhNote = buildFHBookingNote(null, (extrasSelected ?? []) as unknown as ExtrasLineItem[])
    const bookingBody = {
      contact: {
        name: meta.guest_name ?? '',
        phone: meta.guest_phone ?? '',
        email: meta.guest_email ?? '',
      },
      customers,
      ...(fhNote ? { note: fhNote } : {}),
    }

    let fhBookingUuid: string | undefined
    try {
      const validation = await fh.validateBooking(Number(meta.avail_pk), bookingBody)
      if (!validation.is_bookable) {
        console.error('[stripe-webhook] FH validation failed:', validation.error)
        if (claimed) await releaseClaim(supabase, pi.id)
        await refundFailedBooking(stripe, supabase, pi, `FareHarbor validation failed: ${validation.error ?? 'unknown'}`)
        return NextResponse.json({ received: true })
      }
      const booking = await fh.createBooking(Number(meta.avail_pk), bookingBody)
      fhBookingUuid = booking?.uuid
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[stripe-webhook] FH createBooking failed:', msg)
      if (claimed) await releaseClaim(supabase, pi.id)
      await refundFailedBooking(stripe, supabase, pi, `FareHarbor error: ${msg}`)
      return NextResponse.json({ received: true })
    }

    // Save to Supabase
    const serverBaseAmount = Number(meta.server_base_amount_cents ?? 0)
    const extrasAmountCents = Number(meta.extras_amount_cents ?? 0)
    // VAT fields may be absent from PI metadata (older intents, browser-side
    // omissions, etc.). Fall back to server-side compute: 9% on base, 21% on
    // extras. City tax is 0% VAT (municipal levy). parseMetaCents keeps an
    // explicit "0" instead of treating it as missing.
    const baseVatAmountCents = parseMetaCents(meta.base_vat_amount_cents)
      ?? extractVat(serverBaseAmount, 9)
    const extrasVatAmountCents = parseMetaCents(meta.extras_vat_amount_cents)
      ?? extractVat(extrasAmountCents, 21)
    const totalVatAmountCents = parseMetaCents(meta.total_vat_amount_cents)
      ?? (baseVatAmountCents + extrasVatAmountCents)

    const { error: dbError } = await supabase.from('bookings').insert({
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

    if (dbError) {
      if (dbError.code === '23505') {
        // Backstop: unexpected under the claim model (we hold the claim, so no
        // other path should have inserted this PI). If it still fires, another
        // path won — cancel our FareHarbor booking so the boat isn't blocked
        // twice. The winning path already sent Slack + email.
        console.warn('[stripe-webhook] 23505 despite claim for PI', pi.id, '— cancelling our FH booking', fhBookingUuid)
        if (fhBookingUuid) {
          try {
            await fh.cancelBooking(fhBookingUuid)
          } catch (err) {
            await alertWebhookFailure(
              pi,
              `Duplicate FH booking ${fhBookingUuid} could not be cancelled: ${err instanceof Error ? err.message : String(err)}`,
              '_Cancel the duplicate FareHarbor booking manually — the customer has a valid booking, do NOT refund._',
            )
          }
        }
        if (claimed) await releaseClaim(supabase, pi.id)
        return NextResponse.json({ received: true })
      }
      console.error('[stripe-webhook] DB save failed for PI', pi.id, dbError)
      // The FareHarbor booking EXISTS — only our DB record failed. Tell ops to
      // REPAIR the row, not to recreate the booking.
      await alertWebhookFailure(
        pi,
        `DB save failed: ${dbError.message}`,
        fhBookingUuid
          ? `_The FareHarbor booking EXISTS (\`${fhBookingUuid}\`). Add the booking row in Supabase — do NOT recreate the FareHarbor booking._`
          : '_Add the booking row in Supabase manually._',
      )
      // Don't return early — still send Slack + email so we know the cruise is booked
    }

    // Booking recorded (or FH exists + ops alerted) — release the claim so the
    // PI is no longer held.
    if (claimed) await releaseClaim(supabase, pi.id)

    const startTime = formatAmsterdamTime(meta.start_at)
    const endTime = formatAmsterdamTime(meta.end_at)
    const slackText = [
      `*New booking confirmed!* 🎉 _(iDEAL/async — via webhook)_`,
      `*${meta.listing_title}*`,
      `📅 ${meta.date} · ${startTime} – ${endTime}`,
      `👥 ${guestCount} guest${guestCount !== 1 ? 's' : ''} · ${meta.category}`,
      `💰 €${(pi.amount / 100).toFixed(0)}`,
      `👤 ${meta.guest_name} · ${meta.guest_email}`,
      fhBookingUuid ? `🎫 FH: ${fhBookingUuid}` : '',
      `💳 PI: ${pi.id}`,
    ].filter(Boolean).join('\n')

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
      }),
      notifyCateringOrder({
        cruiseName: meta.listing_title ?? '',
        dateStr: meta.date ?? null,
        startTimeStr: meta.start_at || null,
        guestCount,
        extrasSelected,
      }),
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
 * A paid PaymentIntent could not be turned into a FareHarbor booking.
 *
 * Before doing anything drastic: wait, then re-check the bookings table. The
 * browser-side /book (card) or /recover (iDEAL) often races this webhook —
 * if it just created the booking, FH validation fails HERE simply because the
 * slot was consumed by the customer's OWN booking. Refunding then would hand
 * money back to someone with a perfectly valid booking.
 *
 * If after the wait there is still no booking anywhere, the customer paid for
 * nothing — issue an automatic refund and alert Slack with the outcome.
 */
async function refundFailedBooking(
  stripe: Stripe,
  supabase: ReturnType<typeof createAdminClient>,
  pi: Stripe.PaymentIntent,
  reason: string,
) {
  await new Promise(resolve => setTimeout(resolve, BOOKING_RECHECK_DELAY_MS))

  const { data: lateBooking } = await supabase
    .from('bookings')
    .select('id')
    .eq('stripe_payment_intent_id', pi.id)
    .maybeSingle()

  if (lateBooking) {
    console.log('[stripe-webhook] booking appeared during recheck — no refund needed for PI', pi.id)
    return
  }

  let refundLine: string
  try {
    const refund = await stripe.refunds.create({
      payment_intent: pi.id,
      metadata: { auto_refund: 'booking_failed', reason: reason.slice(0, 450) },
    })
    refundLine = `↩️ *Auto-refund issued* (\`${refund.id}\`) — money is on its way back to the customer. Please contact them to explain and offer to rebook.`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    refundLine = msg.toLowerCase().includes('already been refunded')
      ? '↩️ Payment was already refunded (earlier attempt) — verify in Stripe, then contact the customer.'
      : `❌ *AUTO-REFUND FAILED* (${msg}) — *refund manually in Stripe now*, then contact the customer.`
  }

  await alertWebhookFailure(pi, reason, refundLine)
}

/**
 * Alert Slack when the webhook can't complete a booking for a paid PI.
 * This is critical — Stripe confirmed the money, but FareHarbor or Supabase failed.
 */
async function alertWebhookFailure(pi: Stripe.PaymentIntent, reason: string, actionLine?: string) {
  const meta = pi.metadata ?? {}

  const text = [
    '🚨 *CRITICAL: WEBHOOK BOOKING FAILED* 🚨',
    '_Customer paid (iDEAL/async) but the booking could not be completed._',
    '',
    `*Reason:* \`${reason}\``,
    `*PI:* \`${pi.id}\`  ·  Amount: €${(pi.amount / 100).toFixed(0)}`,
    `*Customer:* ${meta.guest_name} · ${meta.guest_email} · ${meta.guest_phone}`,
    `*Cruise:* ${meta.listing_title}  ·  Date: ${meta.date}`,
    `*Avail PK:* ${meta.avail_pk}  ·  CT Rate PK:* ${meta.customer_type_rate_pk}`,
    '',
    actionLine ?? '_Manually create the FareHarbor booking and send a confirmation email._',
  ].join('\n')

  if (process.env.SLACK_WEBHOOK_URL) {
    await postSlackText(text)
  } else {
    console.error('[stripe-webhook] CRITICAL (no Slack configured):', text)
  }
}
