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
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')
  const firstName = esc(p.contact.name.split(' ')[0])

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

  const DL = 'color:#71717a;padding:5px 12px 5px 0;white-space:nowrap;vertical-align:top;font-size:14px;'
  const DV = 'color:#1e1b4b;font-weight:500;text-align:right;padding:5px 0;vertical-align:top;font-size:14px;'

  const extrasRows = p.extrasSelected.length > 0
    ? p.extrasSelected.map(e => `
        <tr>
          <td style="${DL}">${formatExtraName(e)}</td>
          <td style="${DV}">${fmtAmountEur(e.amount_cents)}</td>
        </tr>`).join('')
    : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Booking confirmed — Off Course Amsterdam</title>
</head>
<body style="margin:0;padding:0;background-color:#f0e9e0;background-image:url(${site}/textures/bg-sand.png);background-size:400px;background-repeat:repeat;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;color:#f0e9e0;">you're booked — see you on the water 🛥️&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:32px 16px 48px;">

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        <!-- ═══ HEADER: deep indigo + logo ═══ -->
        <tr>
          <td bgcolor="#1e1b4b" style="background-color:#1e1b4b;padding:36px 32px 0;border-radius:20px 20px 0 0;text-align:center;">
            <a href="https://offcourseamsterdam.com" style="display:inline-block;">
              <img src="${site}/logos/offcourse-vertical.png" alt="Off Course Amsterdam" width="80" style="display:block;margin:0 auto;width:80px;height:auto;" />
            </a>
          </td>
        </tr>

        <!-- ═══ CRUISE STRIP: still indigo ═══ -->
        <tr>
          <td bgcolor="#1e1b4b" style="background-color:#1e1b4b;padding:20px 32px 36px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.08);">
            <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.4);">booking confirmed 🎉</p>
            <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.3;">${esc(p.listingTitle)}</h1>
          </td>
        </tr>

        <!-- ═══ BODY: white card ═══ -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding:36px 32px 32px;border-radius:0 0 20px 20px;">

            <!-- Greeting -->
            <p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1e1b4b;">Hey ${firstName} 👋</p>
            <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">
              You're all set — your spot is reserved. See you on the water!
            </p>

            <!-- Detail block -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
              <tr>
                <td bgcolor="#f7f4f0" style="background-color:#f7f4f0;border-radius:12px;padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="${DL}">Cruise</td>
                      <td style="color:#1e1b4b;font-weight:600;text-align:right;padding:5px 0;vertical-align:top;font-size:14px;">${esc(p.listingTitle)}</td>
                    </tr>
                    ${typeValue ? `<tr>
                      <td style="${DL}">Type</td>
                      <td style="${DV}">${typeValue}</td>
                    </tr>` : ''}
                    <tr>
                      <td style="${DL}">Date</td>
                      <td style="${DV}">${esc(p.date)}</td>
                    </tr>
                    ${timeRange ? `<tr>
                      <td style="${DL}">Time</td>
                      <td style="${DV}">${timeRange}</td>
                    </tr>` : ''}
                    <tr>
                      <td style="${DL}">Guests</td>
                      <td style="${DV}">${p.guestCount} guest${p.guestCount !== 1 ? 's' : ''}</td>
                    </tr>
                    ${extrasRows}
                    ${p.fhBookingUuid ? `<tr>
                      <td style="${DL}">Ref</td>
                      <td style="color:#1e1b4b;font-family:monospace;font-size:12px;text-align:right;padding:5px 0;vertical-align:top;">${esc(p.fhBookingUuid)}</td>
                    </tr>` : ''}
                    <tr>
                      <td style="color:#71717a;padding:12px 12px 0 0;white-space:nowrap;vertical-align:top;font-size:14px;border-top:1px solid #e8e3dc;">Paid</td>
                      <td style="font-size:18px;font-weight:700;color:#1e1b4b;text-align:right;padding:12px 0 0;vertical-align:top;border-top:1px solid #e8e3dc;">${fmtAmountEur(p.amountCents)}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Location notice -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
              <tr>
                <td style="background-color:#eef0f8;border:1px solid rgba(30,27,75,0.2);border-radius:12px;padding:16px 20px;font-size:14px;color:#1e1b4b;line-height:1.6;">
                  <strong style="display:block;margin-bottom:6px;color:#1e1b4b;">📍 Where to meet us</strong>
                  ${location} — look for the big pier/jetty on the waterfront.<br/>
                  Please be there <strong>10 minutes before</strong> your departure time — your skipper will be ready and waiting.<br/>
                  <a href="https://maps.app.goo.gl/UR1tijSgfdMVfgLi6" style="color:#5b50b0;font-weight:600;">Open in Google Maps →</a>
                </td>
              </tr>
            </table>

            <!-- Sign-off -->
            <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
              Questions? Reply to this email or reach us at <a href="mailto:cruise@offcourseamsterdam.com" style="color:#1e1b4b;font-weight:600;">cruise@offcourseamsterdam.com</a>
            </p>

          </td>
        </tr>

        <!-- ═══ SPACER ═══ -->
        <tr><td style="height:24px;"></td></tr>

        <!-- ═══ FOOTER ═══ -->
        <tr>
          <td style="text-align:center;padding:0 16px;">
            <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;line-height:1.6;">Off Course Amsterdam &mdash; your friend with a boat</p>
            <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
              Herenmarkt 93A, Amsterdam &nbsp;·&nbsp;
              <a href="mailto:cruise@offcourseamsterdam.com" style="color:#9ca3af;text-decoration:none;">cruise@offcourseamsterdam.com</a>
            </p>
          </td>
        </tr>

      </table>

    </td></tr>
  </table>

</body>
</html>`

  try {
    await resend.emails.send({
      from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
      to: [p.contact.email],
      subject: `you're booked 🎉 — ${p.listingTitle}`,
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
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')
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

  const DL = 'color:#71717a;padding:5px 12px 5px 0;white-space:nowrap;vertical-align:top;font-size:14px;'
  const DV = 'color:#1e1b4b;font-weight:500;text-align:right;padding:5px 0;vertical-align:top;font-size:14px;'

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Your booking has been rescheduled — Off Course Amsterdam</title>
</head>
<body style="margin:0;padding:0;background-color:#f0e9e0;background-image:url(${site}/textures/bg-sand.png);background-size:400px;background-repeat:repeat;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;color:#f0e9e0;">your cruise has moved to a new date — here are the updated details&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:32px 16px 48px;">

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        <!-- ═══ HEADER: deep indigo + logo ═══ -->
        <tr>
          <td bgcolor="#1e1b4b" style="background-color:#1e1b4b;padding:36px 32px 0;border-radius:20px 20px 0 0;text-align:center;">
            <a href="https://offcourseamsterdam.com" style="display:inline-block;">
              <img src="${site}/logos/offcourse-vertical.png" alt="Off Course Amsterdam" width="80" style="display:block;margin:0 auto;width:80px;height:auto;" />
            </a>
          </td>
        </tr>

        <!-- ═══ CRUISE STRIP: still indigo ═══ -->
        <tr>
          <td bgcolor="#1e1b4b" style="background-color:#1e1b4b;padding:20px 32px 36px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.08);">
            <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.4);">booking rescheduled 📅</p>
            <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.3;">${esc(p.listingTitle)}</h1>
          </td>
        </tr>

        <!-- ═══ BODY: white card ═══ -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding:36px 32px 32px;border-radius:0 0 20px 20px;">

            <!-- Greeting -->
            <p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1e1b4b;">Hey ${firstName} 👋</p>
            <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7;">
              Your booking has been moved to a new date. Here are the updated details — everything else stays the same.
            </p>

            <!-- Rescheduled badge -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
              <tr>
                <td style="background-color:#eef0f8;border:1px solid rgba(30,27,75,0.2);border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;color:#1e1b4b;">
                  📅 Your booking has been rescheduled
                </td>
              </tr>
            </table>

            <!-- Detail block -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
              <tr>
                <td bgcolor="#f7f4f0" style="background-color:#f7f4f0;border-radius:12px;padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="${DL}">Cruise</td>
                      <td style="color:#1e1b4b;font-weight:600;text-align:right;padding:5px 0;vertical-align:top;font-size:14px;">${esc(p.listingTitle)}</td>
                    </tr>
                    ${typeValue ? `<tr>
                      <td style="${DL}">Type</td>
                      <td style="${DV}">${typeValue}</td>
                    </tr>` : ''}
                    <tr>
                      <td style="${DL}">New date</td>
                      <td style="${DV}">${esc(p.newDate)}</td>
                    </tr>
                    ${timeRange ? `<tr>
                      <td style="${DL}">New time</td>
                      <td style="${DV}">${timeRange}</td>
                    </tr>` : ''}
                    <tr>
                      <td style="${DL}">Guests</td>
                      <td style="${DV}">${p.guestCount} guest${p.guestCount !== 1 ? 's' : ''}</td>
                    </tr>
                    ${p.fhBookingUuid ? `<tr>
                      <td style="${DL}">Ref</td>
                      <td style="color:#1e1b4b;font-family:monospace;font-size:12px;text-align:right;padding:5px 0;vertical-align:top;">${esc(p.fhBookingUuid)}</td>
                    </tr>` : ''}
                  </table>
                </td>
              </tr>
            </table>

            <!-- Location notice -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
              <tr>
                <td style="background-color:#eef0f8;border:1px solid rgba(30,27,75,0.2);border-radius:12px;padding:16px 20px;font-size:14px;color:#1e1b4b;line-height:1.6;">
                  <strong style="display:block;margin-bottom:6px;color:#1e1b4b;">📍 Where to meet us</strong>
                  ${location} — look for the big pier/jetty on the waterfront.<br/>
                  Please be there <strong>10 minutes before</strong> your departure time — your skipper will be ready and waiting.<br/>
                  <a href="https://maps.app.goo.gl/UR1tijSgfdMVfgLi6" style="color:#5b50b0;font-weight:600;">Open in Google Maps →</a>
                </td>
              </tr>
            </table>

            <!-- Sign-off -->
            <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
              Questions? Reply to this email or reach us at <a href="mailto:cruise@offcourseamsterdam.com" style="color:#1e1b4b;font-weight:600;">cruise@offcourseamsterdam.com</a>. See you on the water!
            </p>

          </td>
        </tr>

        <!-- ═══ SPACER ═══ -->
        <tr><td style="height:24px;"></td></tr>

        <!-- ═══ FOOTER ═══ -->
        <tr>
          <td style="text-align:center;padding:0 16px;">
            <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;line-height:1.6;">Off Course Amsterdam &mdash; your friend with a boat</p>
            <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
              Herenmarkt 93A, Amsterdam &nbsp;·&nbsp;
              <a href="mailto:cruise@offcourseamsterdam.com" style="color:#9ca3af;text-decoration:none;">cruise@offcourseamsterdam.com</a>
            </p>
          </td>
        </tr>

      </table>

    </td></tr>
  </table>

</body>
</html>`

  try {
    await resend.emails.send({
      from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
      to: [p.contact.email],
      subject: `your booking has moved 📅 — ${p.listingTitle}`,
      html,
    })
    console.log('[sendRescheduleEmail] sent to', p.contact.email)
  } catch (err) {
    console.error('[sendRescheduleEmail] error:', err)
  }
}
