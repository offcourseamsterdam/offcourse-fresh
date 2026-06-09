import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterCateringItems } from '@/lib/catering/filter'
import { buildCateringEmailText, buildCateringEmailSubject } from '@/lib/catering/email-template'
import { postSlackText } from '@/lib/slack/send-notification'
import { formatAmsterdamTime } from '@/lib/utils'
import { Resend } from 'resend'

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY ?? '')
  return _resend
}

async function fetchBookingForCatering(id: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, customer_name, listing_title, tour_item_name,
      booking_date, start_time, guest_count, category,
      extras_selected, catering_email_sent_at
    `)
    .eq('id', id)
    .single()
  return { booking: data, error }
}

// ── GET — return the email text for in-admin preview ──────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const { booking, error } = await fetchBookingForCatering(id)
    if (error || !booking) return apiError('Booking not found', 404)

    const cateringItems = filterCateringItems(booking.extras_selected as never)
    if (cateringItems.length === 0) return apiError('No catering items on this booking', 400)

    const text = buildCateringEmailText({
      cruiseName: booking.listing_title ?? booking.tour_item_name ?? 'Cruise',
      dateStr: booking.booking_date,
      timeStr: booking.start_time,
      guestCount: booking.guest_count,
      items: cateringItems,
    })

    return apiOk({ text, alreadySent: !!booking.catering_email_sent_at })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

// ── POST — send (or resend) the catering email to the supplier ────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const { booking, error: fetchErr } = await fetchBookingForCatering(id)
    if (fetchErr || !booking) return apiError('Booking not found', 404)

    const isResend = !!booking.catering_email_sent_at

    const cateringItems = filterCateringItems(booking.extras_selected as never)
    if (cateringItems.length === 0) return apiError('No catering items on this booking', 400)

    const cruiseName = booking.listing_title ?? booking.tour_item_name ?? 'Cruise'
    const text = buildCateringEmailText({
      cruiseName,
      dateStr: booking.booking_date,
      timeStr: booking.start_time,
      guestCount: booking.guest_count,
      items: cateringItems,
    })

    const recipient = process.env.CATERING_EMAIL_RECIPIENT ?? 'info@offcourseamsterdam.com'
    const subject = buildCateringEmailSubject(cruiseName, booking.booking_date, booking.start_time)

    if (process.env.RESEND_API_KEY) {
      const resend = getResend()
      await resend.emails.send({
        from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
        to: [recipient],
        subject: isResend ? `[UPDATED] ${subject}` : subject,
        text,
      })
    }

    // Slack confirmation
    const itemSummary = cateringItems
      .map(i => {
        const qty = i.quantity ?? 1
        if (i.is_per_person_pick && qty > 0) {
          return `• ${i.name} (for ${qty} ${qty === 1 ? 'person' : 'people'})`
        }
        return `• ${i.name}${qty > 1 ? ` ×${qty}` : ''}`
      })
      .join('\n')
    const dateLabel = booking.booking_date
      ? new Date(booking.booking_date + 'T12:00:00').toLocaleDateString('en-NL', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        })
      : '—'
    const timeLabel = formatAmsterdamTime(booking.start_time)
    const slackPrefix = isResend ? '🔄 *Catering order resent to supplier*' : '🍽️ *Catering order sent to supplier*'
    await postSlackText(
      `${slackPrefix}\n*${cruiseName}* — ${dateLabel} at ${timeLabel}\n${booking.guest_count ? `${booking.guest_count} guests\n` : ''}${itemSummary}`
    )

    // Always update the sent timestamp so we know when the last send was
    const supabase = createAdminClient()
    const { error: updateErr } = await supabase
      .from('bookings')
      .update({ catering_email_sent_at: new Date().toISOString() })
      .eq('id', id)

    if (updateErr) return apiError(updateErr.message)

    return apiOk({ sent: true, resent: isResend, recipient })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
