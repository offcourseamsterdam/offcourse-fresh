import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterCateringItems, cateringAmountCents } from '@/lib/catering/filter'
import { Resend } from 'resend'

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY ?? '')
  return _resend
}

function fmtAmountEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-NL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function fmtTime(timeStr: string | null): string {
  if (!timeStr) return '—'
  return new Date(timeStr).toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam',
  })
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select(`
        id, customer_name, listing_title, tour_item_name,
        booking_date, start_time, guest_count, category,
        extras_selected, catering_email_sent_at
      `)
      .eq('id', id)
      .single()

    if (fetchErr || !booking) return apiError('Booking not found', 404)

    // Idempotency guard — don't send twice
    if (booking.catering_email_sent_at) {
      return apiError('Catering email already sent', 409)
    }

    const cateringItems = filterCateringItems(booking.extras_selected as never)
    if (cateringItems.length === 0) {
      return apiError('No catering items on this booking', 400)
    }

    const recipient = process.env.CATERING_EMAIL_RECIPIENT ?? 'info@offcourseamsterdam.com'
    const cruiseName = booking.listing_title ?? booking.tour_item_name ?? 'Cruise'
    const guestName = booking.customer_name ?? 'Guest'
    const dateLabel = fmtDate(booking.booking_date)
    const timeLabel = fmtTime(booking.start_time)
    const totalCents = cateringAmountCents(booking.extras_selected as never)

    const itemRows = cateringItems
      .map(item => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;">${item.name}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#52525b;text-align:center;">${item.quantity ?? 1}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;text-align:right;font-weight:600;">${fmtAmountEur(item.amount_cents)}</td>
        </tr>`)
      .join('')

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Catering Order — Off Course Amsterdam</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f5;margin:0;padding:32px 16px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#18181b;color:#fff;padding:32px 32px 24px;">
      <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;">Catering Order</h1>
      <p style="margin:0;font-size:14px;color:#a1a1aa;">Off Course Amsterdam · ${dateLabel} · ${timeLabel}</p>
    </div>

    <!-- Body -->
    <div style="padding:32px;">

      <!-- Booking details -->
      <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:14px;">
          <span style="color:#71717a;">Guest</span>
          <span style="color:#18181b;font-weight:500;">${guestName}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:14px;">
          <span style="color:#71717a;">Cruise</span>
          <span style="color:#18181b;font-weight:500;">${cruiseName}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:14px;">
          <span style="color:#71717a;">Date</span>
          <span style="color:#18181b;font-weight:500;">${dateLabel}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:14px;">
          <span style="color:#71717a;">Time</span>
          <span style="color:#18181b;font-weight:500;">${timeLabel}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:14px;">
          <span style="color:#71717a;">Guests</span>
          <span style="color:#18181b;font-weight:500;">${booking.guest_count ?? '—'}</span>
        </div>
      </div>

      <!-- Catering items table -->
      <h2 style="font-size:16px;font-weight:700;color:#18181b;margin:0 0 12px;">Catering Items</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#f4f4f5;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#71717a;">Item</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#71717a;">Qty</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#71717a;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr style="background:#f9f9f9;">
            <td colspan="2" style="padding:12px;font-size:14px;font-weight:700;color:#18181b;">Total</td>
            <td style="padding:12px;font-size:16px;font-weight:700;color:#18181b;text-align:right;">${fmtAmountEur(totalCents)}</td>
          </tr>
        </tbody>
      </table>

      <p style="font-size:13px;color:#71717a;line-height:1.6;margin:0;">
        Questions? Contact us at
        <a href="mailto:cruise@offcourseamsterdam.com" style="color:#52525b;">cruise@offcourseamsterdam.com</a>.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f4f4f5;padding:20px 32px;text-align:center;font-size:12px;color:#a1a1aa;">
      <a href="https://offcourseamsterdam.com" style="color:#52525b;text-decoration:none;">offcourseamsterdam.com</a>
      &nbsp;·&nbsp; Amsterdam, Netherlands
    </div>
  </div>
</body>
</html>`.trim()

    if (process.env.RESEND_API_KEY) {
      const resend = getResend()
      await resend.emails.send({
        from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
        to: [recipient],
        subject: `Catering Order — ${guestName} — ${dateLabel} ${timeLabel}`,
        html,
      })
    }

    // Stamp catering_email_sent_at
    const { error: updateErr } = await supabase
      .from('bookings')
      .update({ catering_email_sent_at: new Date().toISOString() })
      .eq('id', id)

    if (updateErr) return apiError(updateErr.message)

    return apiOk({ sent: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
