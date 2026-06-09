import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { escapeHtml as esc } from '@/lib/utils'

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY ?? '')
  return _resend
}

function fmtAmountEur(cents: number) {
  return `€${(cents / 100).toFixed(0)}`
}

/** "5:00 PM" — clean English AM/PM format, Amsterdam timezone. */
function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Europe/Amsterdam',
  })
}

/** "Private" / "Shared" for known categories; null otherwise. */
function fmtCategory(category?: string | null): string | null {
  if (category === 'private') return 'Private'
  if (category === 'shared')  return 'Shared'
  return null
}

/**
 * Lookup the customer-type info (name + duration) for a given rate PK
 * by walking the `fareharbor_items.customer_types` JSONB array.
 *
 * Returns null if not found or if the lookup fails. The function silently
 * absorbs errors — the email still sends without the enriched info.
 */
async function lookupCustomerTypeInfo(
  ratePk: number | null | undefined,
): Promise<{ name: string; duration_minutes: number } | null> {
  if (!ratePk) return null
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('fareharbor_items')
      .select('customer_types')
      .contains('customer_types', [{ fareharbor_pk: ratePk }])
      .maybeSingle()
    if (error || !data) return null

    type CtRow = { fareharbor_pk: number; name?: string; duration_minutes?: number }
    const cts = (data.customer_types ?? []) as CtRow[]
    const found = cts.find(ct => ct.fareharbor_pk === ratePk)
    if (found?.name) {
      return {
        name: found.name,
        duration_minutes: found.duration_minutes ?? 0,
      }
    }
  } catch (err) {
    console.error('[sendConfirmationEmail] customer-type lookup failed:', err)
  }
  return null
}

export interface ConfirmationEmailInput {
  contact: { name: string; email: string; phone?: string }
  listingTitle: string
  /** Defaults to 'Brouwersgracht 29, Amsterdam' when omitted. */
  departureLocation?: string
  date: string
  startAt: string | null
  endAt: string | null
  guestCount: number
  amountCents: number
  extrasSelected: Array<{
    name: string
    amount_cents: number
    quantity?: number
    /** When true, the quantity represents the number of people this item was
     *  ordered for (e.g. Charcuterie for 4 people), not the number of items. */
    is_per_person_pick?: boolean
  }>
  fhBookingUuid?: string
  /** 'private' or 'shared' — surfaces a clear category label in the email. */
  category?: string | null
  /** PK of the chosen customer-type-rate. Used to look up the type name
   *  (e.g. "Curaçao 2-hour") + duration_minutes. The duration corrects
   *  the end-time for private cruises, where FareHarbor returns
   *  `end_at == start_at` (the real duration lives on the rate). */
  fareharborCustomerTypeRatePk?: number | null
}

export async function sendConfirmationEmail(p: ConfirmationEmailInput): Promise<void> {
  if (!process.env.RESEND_API_KEY) return

  const resend = getResend()
  const location = esc(p.departureLocation ?? 'Brouwersgracht 29, Amsterdam')

  // ── Customer type lookup + end-time correction ──────────────────────────
  // Private cruises: FH returns end_at == start_at; recompute from duration.
  // Shared cruises: end_at is correct; lookup still gives us the type name.
  const ctInfo = await lookupCustomerTypeInfo(p.fareharborCustomerTypeRatePk)

  let effectiveEndAt = p.endAt
  if (ctInfo?.duration_minutes && p.startAt) {
    const startMs = new Date(p.startAt).getTime()
    const endMs = p.endAt ? new Date(p.endAt).getTime() : startMs
    if (Math.abs(endMs - startMs) < 60_000) {
      effectiveEndAt = new Date(startMs + ctInfo.duration_minutes * 60_000).toISOString()
    }
  }

  const startTime = fmtTime(p.startAt)
  const endTime = fmtTime(effectiveEndAt)
  const timeRange = startTime && endTime && startTime !== endTime
    ? `${startTime} – ${endTime}`
    : startTime

  // ── Type + category row content ─────────────────────────────────────────
  const categoryLabel = fmtCategory(p.category)
  // Append "× N" only for shared cruises with > 1 guest (e.g. "Adult × 4 · Shared")
  // Private bookings are 1 boat regardless of guest count.
  const typeBase = ctInfo?.name ? esc(ctInfo.name) : null
  const typeWithQty = typeBase && p.category === 'shared' && p.guestCount > 1
    ? `${typeBase} × ${p.guestCount}`
    : typeBase
  const typeValue = [typeWithQty, categoryLabel].filter(Boolean).join(' · ') || null

  // ── Extras ──────────────────────────────────────────────────────────────
  function formatExtraName(e: { name: string; quantity?: number; is_per_person_pick?: boolean }) {
    const safeName = esc(e.name)
    const qty = e.quantity ?? 1
    if (e.is_per_person_pick && qty > 0) {
      return `${safeName} — for ${qty} ${qty === 1 ? 'person' : 'people'}`
    }
    if (qty > 1) return `${safeName} × ${qty}`
    return safeName
  }
  const extrasRows = p.extrasSelected.length > 0
    ? p.extrasSelected.map(e => `
        <tr>
          <td class="detail-label">${formatExtraName(e)}</td>
          <td class="detail-value">${fmtAmountEur(e.amount_cents)}</td>
        </tr>`).join('')
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
    .detail-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .detail-table tr td { padding: 5px 0; vertical-align: top; }
    .detail-label { color: #71717a; padding-right: 12px; white-space: nowrap; }
    .detail-value { color: #18181b; font-weight: 500; text-align: right; }
    .amount-row td { border-top: 1px solid #e4e4e7; padding-top: 14px; margin-top: 14px; }
    .amount-value { font-size: 18px; font-weight: 700; color: #18181b; text-align: right; }
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
      <p class="greeting">Hi ${esc(p.contact.name.split(' ')[0])}, your booking is confirmed!</p>

      <div class="detail-block">
        <table class="detail-table">
          <tr>
            <td class="detail-label">Cruise</td>
            <td class="detail-value">${esc(p.listingTitle)}</td>
          </tr>
          ${typeValue ? `<tr>
            <td class="detail-label">Type</td>
            <td class="detail-value">${typeValue}</td>
          </tr>` : ''}
          <tr>
            <td class="detail-label">Date</td>
            <td class="detail-value">${esc(p.date)}</td>
          </tr>
          ${timeRange ? `<tr>
            <td class="detail-label">Time</td>
            <td class="detail-value">${timeRange}</td>
          </tr>` : ''}
          <tr>
            <td class="detail-label">Guests</td>
            <td class="detail-value">${p.guestCount} guest${p.guestCount !== 1 ? 's' : ''}</td>
          </tr>
          ${extrasRows}
          ${p.fhBookingUuid ? `<tr>
            <td class="detail-label">Booking ref</td>
            <td class="detail-value" style="font-family: monospace; font-size: 12px;">${esc(p.fhBookingUuid)}</td>
          </tr>` : ''}
          <tr class="amount-row">
            <td class="detail-label">Paid</td>
            <td class="amount-value">${fmtAmountEur(p.amountCents)}</td>
          </tr>
        </table>
      </div>

      <div class="notice-block">
        <strong>📍 Where to meet us</strong>
        ${location} — look for the big pier/jetty on the waterfront.<br/>
        Please be there <strong>10 minutes before</strong> your departure time — your skipper will be ready and waiting.<br/>
        <a href="https://maps.app.goo.gl/UR1tijSgfdMVfgLi6" style="color:#92400e;">Open in Google Maps →</a>
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
    console.error('[sendConfirmationEmail] error:', err)
  }
}

// ── Reschedule confirmation ───────────────────────────────────────────────────

export interface RescheduleEmailInput {
  contact: { name: string; email: string }
  listingTitle: string
  departureLocation?: string
  newDate: string
  newStartAt: string | null
  newEndAt: string | null
  guestCount: number
  amountCents: number
  fhBookingUuid?: string
  category?: string | null
  fareharborCustomerTypeRatePk?: number | null
}

/**
 * Sent when an admin reschedules an existing booking.
 * Same structure as the booking confirmation but with a clear "rescheduled" header.
 */
export async function sendRescheduleEmail(p: RescheduleEmailInput): Promise<void> {
  if (!process.env.RESEND_API_KEY) return

  const resend = getResend()
  const location = esc(p.departureLocation ?? 'Brouwersgracht 29, Amsterdam')
  const firstName = esc(p.contact.name.split(' ')[0])

  // Resolve correct end time (private cruises have end_at == start_at in FH)
  const ctInfo = await lookupCustomerTypeInfo(p.fareharborCustomerTypeRatePk)
  let effectiveEndAt = p.newEndAt
  if (ctInfo?.duration_minutes && p.newStartAt) {
    const startMs = new Date(p.newStartAt).getTime()
    const endMs = p.newEndAt ? new Date(p.newEndAt).getTime() : startMs
    if (Math.abs(endMs - startMs) < 60_000) {
      effectiveEndAt = new Date(startMs + ctInfo.duration_minutes * 60_000).toISOString()
    }
  }

  const startTime = fmtTime(p.newStartAt)
  const endTime   = fmtTime(effectiveEndAt)
  const timeRange = startTime && endTime && startTime !== endTime
    ? `${startTime} – ${endTime}`
    : startTime

  const categoryLabel = fmtCategory(p.category)
  const typeBase = ctInfo?.name ? esc(ctInfo.name) : null
  const typeValue = [typeBase, categoryLabel].filter(Boolean).join(' · ') || null

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Your booking has been rescheduled — Off Course Amsterdam</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 32px 16px; }
    .container { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .header { background: #18181b; color: #fff; padding: 32px 32px 24px; }
    .header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
    .header p  { margin: 0; font-size: 14px; color: #a1a1aa; }
    .body { padding: 32px; }
    .greeting { font-size: 16px; color: #18181b; margin: 0 0 20px; }
    .badge { display: inline-block; background: #fefce8; border: 1px solid #fde047; color: #713f12; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; margin-bottom: 20px; }
    .detail-block { background: #f4f4f5; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .detail-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .detail-table tr td { padding: 5px 0; vertical-align: top; }
    .detail-label { color: #71717a; padding-right: 12px; white-space: nowrap; }
    .detail-value { color: #18181b; font-weight: 500; text-align: right; }
    .notice-block { background: #fefce8; border: 1px solid #fde047; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; font-size: 14px; color: #713f12; line-height: 1.5; }
    .notice-block strong { display: block; margin-bottom: 4px; }
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
      <p class="greeting">Hi ${firstName},</p>
      <span class="badge">📅 Your booking has been rescheduled</span>

      <div class="detail-block">
        <table class="detail-table">
          <tr>
            <td class="detail-label">Cruise</td>
            <td class="detail-value">${esc(p.listingTitle)}</td>
          </tr>
          ${typeValue ? `<tr>
            <td class="detail-label">Type</td>
            <td class="detail-value">${typeValue}</td>
          </tr>` : ''}
          <tr>
            <td class="detail-label">New date</td>
            <td class="detail-value">${esc(p.newDate)}</td>
          </tr>
          ${timeRange ? `<tr>
            <td class="detail-label">New time</td>
            <td class="detail-value">${timeRange}</td>
          </tr>` : ''}
          <tr>
            <td class="detail-label">Guests</td>
            <td class="detail-value">${p.guestCount} guest${p.guestCount !== 1 ? 's' : ''}</td>
          </tr>
          ${p.fhBookingUuid ? `<tr>
            <td class="detail-label">Booking ref</td>
            <td class="detail-value" style="font-family: monospace; font-size: 12px;">${esc(p.fhBookingUuid)}</td>
          </tr>` : ''}
        </table>
      </div>

      <div class="notice-block">
        <strong>📍 Where to meet us</strong>
        ${location} — look for the big pier/jetty on the waterfront.<br/>
        Please be there <strong>10 minutes before</strong> your departure time — your skipper will be ready and waiting.<br/>
        <a href="https://maps.app.goo.gl/UR1tijSgfdMVfgLi6" style="color:#92400e;">Open in Google Maps →</a>
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
</html>`.trim()

  try {
    await resend.emails.send({
      from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
      to: [p.contact.email],
      subject: `Your booking has been rescheduled — ${p.listingTitle}`,
      html,
    })
    console.log('[sendRescheduleEmail] sent to', p.contact.email)
  } catch (err) {
    console.error('[sendRescheduleEmail] error:', err)
  }
}
