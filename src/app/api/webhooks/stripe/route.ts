import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { sendConfirmationEmail } from '@/lib/booking/send-confirmation-email'
import { notifyCateringOrder } from '@/lib/catering/notify'
import { extractVat } from '@/lib/extras/calculate'
import { reportBookingConversion } from '@/lib/google-ads/report-conversion'
import { reportRefundAdjustment } from '@/lib/google-ads/report-refund'
import type Stripe from 'stripe'

export async function POST(request: NextRequest) {
  const stripe = getStripe()
  const body = await request.text()
  const sig = request.headers.get('stripe-signature') ?? ''
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ''

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createAdminClient()

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

    // Retrieve extras line items from the stored quote breakdown.
    // The quote was consumed at intent creation time but stays in the table for lookups.
    type ExtraLineItem = {
      name: string
      amount_cents: number
      category?: string
      extra_id?: string
      quantity?: number
      is_per_person_pick?: boolean
    }
    let extrasSelected: ExtraLineItem[] = []
    const quoteId = meta.quote_id
    if (quoteId) {
      const { data: quoteRow } = await supabase
        .from('pricing_quotes')
        .select('breakdown, extras_amount_cents')
        .eq('id', quoteId)
        .maybeSingle()

      if (quoteRow?.breakdown) {
        type Breakdown = {
          extrasCalculation?: {
            line_items?: Array<{
              name?: string
              amount_cents?: number
              category?: string
              extra_id?: string
              quantity?: number
              is_per_person_pick?: boolean
            }>
          }
        }
        const bd = quoteRow.breakdown as Breakdown
        extrasSelected = (bd.extrasCalculation?.line_items ?? [])
          .filter(li => Boolean(li.name) && typeof li.amount_cents === 'number' && li.amount_cents > 0)
          .map(li => ({
            name: li.name!,
            amount_cents: li.amount_cents!,
            ...(li.category ? { category: li.category } : {}),
            ...(li.extra_id ? { extra_id: li.extra_id } : {}),
            ...(li.quantity != null ? { quantity: li.quantity } : {}),
            ...(li.is_per_person_pick ? { is_per_person_pick: true } : {}),
          }))
      }
    }

    // Create the FareHarbor booking
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
        console.error('[stripe-webhook] FH validation failed:', validation.error)
        await alertWebhookFailure(pi, `FareHarbor validation failed: ${validation.error ?? 'unknown'}`)
        return NextResponse.json({ received: true })
      }
      const booking = await fh.createBooking(Number(meta.avail_pk), bookingBody)
      fhBookingUuid = booking?.uuid
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[stripe-webhook] FH createBooking failed:', msg)
      await alertWebhookFailure(pi, `FareHarbor error: ${msg}`)
      return NextResponse.json({ received: true })
    }

    // Save to Supabase
    const serverBaseAmount = Number(meta.server_base_amount_cents ?? 0)
    const extrasAmountCents = Number(meta.extras_amount_cents ?? 0)
    // VAT fields may be absent from PI metadata (older intents, browser-side
    // omissions, etc.). Fall back to server-side compute: 9% on base, 21% on
    // extras. City tax is 0% VAT (municipal levy).
    const baseVatAmountCents = Number(meta.base_vat_amount_cents)
      || extractVat(serverBaseAmount, 9)
    const extrasVatAmountCents = Number(meta.extras_vat_amount_cents)
      || extractVat(extrasAmountCents, 21)
    const totalVatAmountCents = Number(meta.total_vat_amount_cents)
      || (baseVatAmountCents + extrasVatAmountCents)

    const { error: dbError } = await supabase.from('bookings').insert({
      booking_id: pi.id,
      booking_uuid: fhBookingUuid ?? null,
      fareharbor_availability_pk: Number(meta.avail_pk),
      fareharbor_customer_type_rate_pk: Number(meta.customer_type_rate_pk),
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
      gclid: meta.gclid || null,
      promo_code_id: meta.promo_code_id || null,
      discount_amount_cents: Number(meta.discount_amount_cents ?? 0),
    })

    if (dbError) {
      console.error('[stripe-webhook] DB save failed for PI', pi.id, dbError)
      await alertWebhookFailure(pi, `DB save failed: ${dbError.message}`)
      // Don't return early — still send Slack + email so we know the cruise is booked
    }

    // Slack notification
    const webhookUrl = process.env.SLACK_WEBHOOK_URL
    if (webhookUrl) {
      const startTime = meta.start_at
        ? new Date(meta.start_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
        : '—'
      const endTime = meta.end_at
        ? new Date(meta.end_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
        : '—'
      const text = [
        `*New booking confirmed!* 🎉 _(iDEAL/async — via webhook)_`,
        `*${meta.listing_title}*`,
        `📅 ${meta.date} · ${startTime} – ${endTime}`,
        `👥 ${guestCount} guest${guestCount !== 1 ? 's' : ''} · ${meta.category}`,
        `💰 €${(pi.amount / 100).toFixed(0)}`,
        `👤 ${meta.guest_name} · ${meta.guest_email}`,
        fhBookingUuid ? `🎫 FH: ${fhBookingUuid}` : '',
        `💳 PI: ${pi.id}`,
      ].filter(Boolean).join('\n')

      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).catch(err => console.error('[stripe-webhook] Slack notification failed:', err))
    }

    // Confirmation email + catering alert (fire concurrently)
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
  }

  // ── charge.refunded ────────────────────────────────────────────────────────
  // Fired when a refund is issued (partial or full) via the Stripe dashboard.
  // Update the booking's payment_status in Supabase + post a Slack note.
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge
    const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null
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

      const webhookUrl = process.env.SLACK_WEBHOOK_URL
      if (webhookUrl) {
        const text = [
          isFullRefund ? '↩️ *Full refund issued*' : '↩️ *Partial refund issued*',
          `Amount refunded: €${(refundedCents / 100).toFixed(2)}`,
          `PI: \`${piId}\``,
        ].join('\n')
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        }).catch(() => {})
      }
    }
  }

  // ── charge.dispute.created ─────────────────────────────────────────────────
  // A customer opened a chargeback. Respond within 7 days or we auto-lose.
  // Send an urgent Slack alert immediately.
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute
    const chargeId = typeof dispute.charge === 'string' ? dispute.charge : (dispute.charge as Stripe.Charge)?.id
    const webhookUrl = process.env.SLACK_WEBHOOK_URL

    if (webhookUrl) {
      const text = [
        '🚨 *CHARGEBACK OPENED* 🚨',
        '_A customer disputed a charge. Respond in Stripe within 7 days to avoid auto-losing._',
        '',
        `Amount: €${(dispute.amount / 100).toFixed(2)}`,
        `Reason: ${dispute.reason ?? 'unknown'}`,
        `Charge: \`${chargeId}\``,
        `Dispute: \`${dispute.id}\``,
        '',
        `https://dashboard.stripe.com/disputes/${dispute.id}`,
      ].join('\n')
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).catch(() => {})
    }
  }

  // ── payment_intent.payment_failed ──────────────────────────────────────────
  // Payment failed (card declined, iDEAL rejected by bank, etc.). The customer
  // sees the error in their browser, so no customer action needed — just log to
  // Slack for visibility on failed attempts.
  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent
    const meta = pi.metadata ?? {}
    const failureMsg = pi.last_payment_error?.message ?? 'unknown reason'
    const webhookUrl = process.env.SLACK_WEBHOOK_URL

    if (webhookUrl) {
      const text = [
        `💳 *Payment failed* — €${(pi.amount / 100).toFixed(0)}`,
        `Reason: ${failureMsg}`,
        meta.listing_title ? `Cruise: ${meta.listing_title}` : '',
        meta.guest_name ? `Guest: ${meta.guest_name} · ${meta.guest_email}` : '',
        `PI: \`${pi.id}\``,
      ].filter(Boolean).join('\n')
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).catch(() => {})
    }
  }

  return NextResponse.json({ received: true })
}

/**
 * Alert Slack when the webhook can't complete a booking for a paid PI.
 * This is critical — Stripe confirmed the money, but FareHarbor or Supabase failed.
 */
async function alertWebhookFailure(pi: Stripe.PaymentIntent, reason: string) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
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
    '_Manually create the FareHarbor booking and send a confirmation email._',
  ].join('\n')

  if (webhookUrl) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(err => console.error('[stripe-webhook] alertWebhookFailure Slack failed:', err))
  } else {
    console.error('[stripe-webhook] CRITICAL (no Slack configured):', text)
  }
}
