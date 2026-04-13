import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { Resend } from 'resend'
import type { BookingSource } from '@/lib/constants'

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY ?? '')
  }
  return _resend
}

/**
 * POST /api/admin/booking-flow/book
 *
 * Step 1: validates the booking with FareHarbor.
 * Step 2: if valid, creates the booking.
 * Step 3: saves to Supabase + sends Slack notification + sends confirmation email.
 *
 * Body: {
 *   availPk, customerTypeRatePk, guestCount, category,
 *   contact: { name, phone, email }, note?,
 *   listingId, listingTitle, date, startAt, endAt,
 *   amountCents, stripePaymentIntentId
 *   baseAmountCents: number      — cruise price in cents (base, excl. extras)
 *   selectedExtraIds?: string[]  — IDs of extras the customer selected
 *   extrasSelected?: object[]    — pre-calculated extras snapshot from create-intent
 *   extrasAmountCents?: number
 *   extrasVatAmountCents?: number
 *   baseVatAmountCents?: number
 *   totalVatAmountCents?: number
 *   bookingSource?: BookingSource — defaults to 'website'; non-website skips Stripe
 *   depositAmountCents?: number   — platform deposit (0 for comp, >0 for platforms)
 * }
 *
 * category: 'private' | 'shared'
 *   Private boats: quantity is always 1 regardless of guest count (the rate IS the boat/duration).
 *   Shared boats: quantity = guestCount (each guest is a separate customer entry).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      availPk, customerTypeRatePk, guestCount, category, contact, note,
      listingId, listingTitle, departureLocation, date, startAt, endAt,
      amountCents, stripePaymentIntentId,
      baseAmountCents, extrasSelected, extrasAmountCents,
      extrasVatAmountCents, baseVatAmountCents, totalVatAmountCents,
      bookingSource = 'website' as BookingSource,
      depositAmountCents,
    } = body

    if (!availPk || !customerTypeRatePk || !guestCount || !contact?.name || !contact?.email || !contact?.phone) {
      return apiError('Missing required fields: availPk, customerTypeRatePk, guestCount, contact.name, contact.email, contact.phone', 400)
    }

    const isInternal = bookingSource !== 'website'

    // Idempotency: if a booking already exists for this payment intent, return it (website only)
    if (stripePaymentIntentId) {
      const supabase = createAdminClient()
      const { data: existing } = await supabase
        .from('bookings')
        .select('id, fareharbor_booking_uuid')
        .eq('stripe_payment_intent_id', stripePaymentIntentId)
        .maybeSingle()
      if (existing) {
        return apiOk({ booking: existing, deduplicated: true })
      }
    }

    const fh = getFareHarborClient()

    // Private boats: book the boat once (quantity=1) — the customer type rate IS the duration.
    // Shared boats: each guest is a separate customer entry.
    const isPrivate = category === 'private'
    const customerCount = isPrivate ? 1 : Number(guestCount)

    const customers = Array.from({ length: customerCount }, () => ({
      customer_type_rate: Number(customerTypeRatePk),
    }))

    const bookingData = {
      contact: {
        name: String(contact.name),
        phone: String(contact.phone),
        email: String(contact.email),
      },
      customers,
      note: note ? String(note) : undefined,
    }

    // Step 1: Validate — FareHarbor always returns 200; is_bookable tells us if it's valid
    const validation = await fh.validateBooking(Number(availPk), bookingData)
    if (!validation.is_bookable) {
      return apiError(validation.error ?? 'Booking is not available', 422)
    }

    // Step 2: Create FareHarbor booking
    const booking = await fh.createBooking(Number(availPk), bookingData)

    // Step 3: Side effects — run concurrently, don't fail the response if they error
    await Promise.allSettled([
      saveToSupabase({
        fhBookingUuid: booking?.uuid,
        availPk: Number(availPk),
        customerTypeRatePk: Number(customerTypeRatePk),
        guestCount: Number(guestCount),
        category: String(category ?? 'private'),
        contact,
        note,
        listingId: listingId ?? null,
        listingTitle: String(listingTitle ?? ''),
        date: String(date ?? ''),
        startAt: startAt ?? null,
        endAt: endAt ?? null,
        amountCents: Number(amountCents ?? 0),
        baseAmountCents: Number(baseAmountCents ?? 0),
        extrasSelected: extrasSelected ?? [],
        extrasAmountCents: Number(extrasAmountCents ?? 0),
        extrasVatAmountCents: Number(extrasVatAmountCents ?? 0),
        baseVatAmountCents: Number(baseVatAmountCents ?? 0),
        totalVatAmountCents: Number(totalVatAmountCents ?? 0),
        stripePaymentIntentId: isInternal ? null : String(stripePaymentIntentId ?? ''),
        bookingSource: String(bookingSource) as BookingSource,
        depositAmountCents: isInternal ? Number(depositAmountCents ?? 0) : null,
      }),
      sendSlackNotification({
        listingTitle: String(listingTitle ?? ''),
        date: String(date ?? ''),
        startAt: startAt ?? null,
        endAt: endAt ?? null,
        guestCount: Number(guestCount),
        category: String(category ?? ''),
        contact,
        amountCents: Number(baseAmountCents ?? 0) + Number(extrasAmountCents ?? 0),
        fhBookingUuid: booking?.uuid,
        stripePaymentIntentId: isInternal ? '' : String(stripePaymentIntentId ?? ''),
        extrasSelected: extrasSelected ?? [],
        totalVatAmountCents: Number(totalVatAmountCents ?? 0),
        bookingSource: bookingSource as BookingSource,
        depositAmountCents: isInternal ? Number(depositAmountCents ?? 0) : null,
      }),
      sendConfirmationEmail({
        contact,
        listingTitle: String(listingTitle ?? ''),
        departureLocation: String(departureLocation ?? 'Keizersgracht 62, Amsterdam'),
        date: String(date ?? ''),
        startAt: startAt ?? null,
        endAt: endAt ?? null,
        guestCount: Number(guestCount),
        amountCents: Number(amountCents ?? 0),
        extrasSelected: (extrasSelected ?? []) as Array<{ name: string; amount_cents: number }>,
        fhBookingUuid: booking?.uuid,
      }),
    ])

    return apiOk({ booking })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}

// ── Side effect helpers ────────────────────────────────────────────────────

interface BookingPayload {
  fhBookingUuid?: string
  availPk: number
  customerTypeRatePk: number
  guestCount: number
  category: string
  contact: { name: string; email: string; phone: string }
  note?: string
  listingId: string | null
  listingTitle: string
  date: string
  startAt: string | null
  endAt: string | null
  amountCents: number
  baseAmountCents: number
  extrasSelected: object[]
  extrasAmountCents: number
  extrasVatAmountCents: number
  baseVatAmountCents: number
  totalVatAmountCents: number
  stripePaymentIntentId: string | null
  bookingSource: BookingSource
  depositAmountCents: number | null
}

async function saveToSupabase(p: BookingPayload) {
  try {
    const supabase = createAdminClient()
    const isInternal = p.bookingSource !== 'website'
    // booking_id: use Stripe PI for website bookings, FH UUID for internal
    const bookingId = isInternal ? (p.fhBookingUuid ?? `internal_${Date.now()}`) : (p.stripePaymentIntentId ?? '')
    await supabase.from('bookings').insert({
      booking_id: bookingId,
      booking_uuid: p.fhBookingUuid ?? null,
      fareharbor_availability_pk: p.availPk,
      fareharbor_customer_type_rate_pk: p.customerTypeRatePk,
      stripe_payment_intent_id: p.stripePaymentIntentId,
      stripe_amount: isInternal ? 0 : p.baseAmountCents + p.extrasAmountCents,
      base_amount_cents: p.baseAmountCents,
      base_vat_rate: 9,
      base_vat_amount_cents: p.baseVatAmountCents,
      extras_amount_cents: p.extrasAmountCents,
      extras_vat_amount_cents: p.extrasVatAmountCents,
      total_vat_amount_cents: p.totalVatAmountCents,
      extras_selected: p.extrasSelected as any,
      listing_id: p.listingId,
      listing_title: p.listingTitle,
      category: p.category,
      booking_date: p.date || null,
      start_time: p.startAt,
      end_time: p.endAt,
      guest_count: p.guestCount,
      customer_name: p.contact.name,
      customer_email: p.contact.email,
      customer_phone: p.contact.phone,
      guest_note: p.note || null,
      status: 'confirmed',
      payment_status: isInternal ? 'comp' : 'paid',
      currency: 'eur',
      booking_source: p.bookingSource,
      deposit_amount_cents: p.depositAmountCents,
    })
  } catch (err) {
    console.error('[book] saveToSupabase error:', err)
  }
}

function fmtAmountEur(cents: number) {
  return `€${(cents / 100).toFixed(0)}`
}

function fmtDatetime(isoDate: string, isoTime: string | null) {
  if (!isoTime) return isoDate
  const d = new Date(isoTime)
  return `${isoDate} ${d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })}`
}

interface SlackPayload {
  listingTitle: string
  date: string
  startAt: string | null
  endAt: string | null
  guestCount: number
  category: string
  contact: { name: string; email: string; phone: string }
  amountCents: number
  fhBookingUuid?: string
  stripePaymentIntentId: string
  extrasSelected: object[]
  totalVatAmountCents: number
  bookingSource?: BookingSource
  depositAmountCents?: number | null
}

async function sendSlackNotification(p: SlackPayload) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return // not configured

  const startTime = p.startAt ? new Date(p.startAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }) : '—'
  const endTime = p.endAt ? new Date(p.endAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }) : '—'

  const isInternal = p.bookingSource && p.bookingSource !== 'website'
  const text = [
    isInternal ? `*New internal booking!* 📋 (${p.bookingSource})` : `*New booking confirmed!* 🎉`,
    `*${p.listingTitle}*`,
    `📅 ${p.date} · ${startTime} – ${endTime}`,
    `👥 ${p.guestCount} guest${p.guestCount !== 1 ? 's' : ''} · ${p.category}`,
    isInternal
      ? (p.depositAmountCents != null ? `💰 Deposit: ${fmtAmountEur(p.depositAmountCents)}` : '')
      : `💰 ${fmtAmountEur(p.amountCents)}`,
    p.extrasSelected.length > 0
      ? `📦 Extras: ${(p.extrasSelected as Array<{name: string; amount_cents: number}>).map(e => `${e.name} €${(e.amount_cents / 100).toFixed(2)}`).join(' · ')}`
      : '',
    `🧾 VAT: €${(p.totalVatAmountCents / 100).toFixed(2)}`,
    `👤 ${p.contact.name} · ${p.contact.email} · ${p.contact.phone}`,
    p.fhBookingUuid ? `🎫 FH: ${p.fhBookingUuid}` : '',
    !isInternal && p.stripePaymentIntentId ? `💳 PI: ${p.stripePaymentIntentId}` : '',
  ].filter(Boolean).join('\n')

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    console.error('[book] sendSlackNotification error:', err)
  }
}

interface EmailPayload {
  contact: { name: string; email: string; phone: string }
  listingTitle: string
  departureLocation: string
  date: string
  startAt: string | null
  endAt: string | null
  guestCount: number
  amountCents: number
  extrasSelected: Array<{ name: string; amount_cents: number }>
  fhBookingUuid?: string
}

async function sendConfirmationEmail(p: EmailPayload) {
  if (!process.env.RESEND_API_KEY) return // not configured

  const resend = getResend()

  const startTime = p.startAt ? new Date(p.startAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }) : ''
  const endTime = p.endAt ? new Date(p.endAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }) : ''
  const timeRange = startTime && endTime ? `${startTime} – ${endTime}` : startTime

  const extrasRows = p.extrasSelected.length > 0
    ? p.extrasSelected.map(e => `
        <div class="detail-row">
          <span class="detail-label">${e.name}</span>
          <span class="detail-value">${fmtAmountEur(e.amount_cents)}</span>
        </div>`).join('')
    : ''

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Booking confirmed — Off Course Amsterdam</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 32px 16px; }
    .container { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .header { background: #18181b; color: #fff; padding: 32px 32px 24px; }
    .header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
    .header p { margin: 0; font-size: 14px; color: #a1a1aa; }
    .body { padding: 32px; }
    .greeting { font-size: 16px; color: #18181b; margin: 0 0 20px; }
    .detail-block { background: #f4f4f5; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .detail-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; font-size: 14px; }
    .detail-row:last-child { margin-bottom: 0; }
    .detail-label { color: #71717a; flex-shrink: 0; margin-right: 12px; }
    .detail-value { color: #18181b; font-weight: 500; text-align: right; }
    .amount-row { border-top: 1px solid #e4e4e7; margin-top: 14px; padding-top: 14px; }
    .amount-row .detail-value { font-size: 18px; font-weight: 700; }
    .notice-block { background: #fefce8; border: 1px solid #fde047; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; font-size: 14px; color: #713f12; line-height: 1.5; }
    .notice-block strong { display: block; margin-bottom: 4px; color: #713f12; }
    .footer-text { font-size: 13px; color: #71717a; line-height: 1.6; margin-bottom: 24px; }
    .footer { background: #f4f4f5; padding: 20px 32px; text-align: center; font-size: 12px; color: #a1a1aa; }
    .footer a { color: #52525b; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Off Course Amsterdam</h1>
      <p>we're down to water</p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${p.contact.name.split(' ')[0]}, your booking is confirmed!</p>

      <div class="detail-block">
        <div class="detail-row">
          <span class="detail-label">Cruise</span>
          <span class="detail-value">${p.listingTitle}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Date</span>
          <span class="detail-value">${p.date}</span>
        </div>
        ${timeRange ? `<div class="detail-row">
          <span class="detail-label">Time</span>
          <span class="detail-value">${timeRange}</span>
        </div>` : ''}
        <div class="detail-row">
          <span class="detail-label">Guests</span>
          <span class="detail-value">${p.guestCount} guest${p.guestCount !== 1 ? 's' : ''}</span>
        </div>
        ${extrasRows}
        ${p.fhBookingUuid ? `<div class="detail-row">
          <span class="detail-label">Booking ref</span>
          <span class="detail-value" style="font-family: monospace; font-size: 12px;">${p.fhBookingUuid}</span>
        </div>` : ''}
        <div class="detail-row amount-row">
          <span class="detail-label">Paid</span>
          <span class="detail-value">${fmtAmountEur(p.amountCents)}</span>
        </div>
      </div>

      <div class="notice-block">
        <strong>📍 Where to meet us</strong>
        ${p.departureLocation}<br/>
        Please be there <strong>10 minutes before</strong> your departure time — your skipper will be ready and waiting.
      </div>

      <p class="footer-text">
        Questions? Reply to this email or reach us at
        <a href="mailto:cruise@offcourseamsterdam.com">cruise@offcourseamsterdam.com</a>.
        See you on the water!
      </p>
    </div>
    <div class="footer">
      <a href="https://offcourseamsterdam.com">offcourseamsterdam.com</a> &nbsp;·&nbsp;
      Amsterdam, Netherlands
    </div>
  </div>
</body>
</html>
  `.trim()

  try {
    await resend.emails.send({
      from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
      to: [p.contact.email],
      subject: `Booking confirmed — ${p.listingTitle}`,
      html,
    })
  } catch (err) {
    console.error('[book] sendConfirmationEmail error:', err)
  }
}
