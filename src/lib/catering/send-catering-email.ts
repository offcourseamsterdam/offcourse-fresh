/**
 * Send (or resend) the catering order email to the supplier for one booking.
 *
 * Shared by the admin "send catering email" button (manual, on-demand — can
 * resend at any time) and the catering-auto-send cron (automatic, once per
 * booking — see src/app/api/cron/catering-auto-send/route.ts). Keeping this
 * in one place means both paths build the same email, post the same Slack
 * confirmation, and update the same FareHarbor note.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { filterFoodItems, type ExtrasLineItem } from './filter'
import { buildCateringEmailText, buildCateringEmailSubject } from './email-template'
import { buildFHBookingNote } from './build-fh-note'
import { postSlackText } from '@/lib/slack/send-notification'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { formatAmsterdamTime } from '@/lib/utils'
import { Resend } from 'resend'

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY ?? '')
  return _resend
}

export type SendCateringEmailResult =
  | { ok: true; resent: boolean; recipient: string }
  | { ok: false; reason: string }

export async function sendCateringOrderEmailForBooking(bookingId: string): Promise<SendCateringEmailResult> {
  const supabase = createAdminClient()
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`
      id, booking_uuid, customer_name, listing_title, tour_item_name,
      booking_date, start_time, guest_count, category,
      extras_selected, catering_email_sent_at, guest_note
    `)
    .eq('id', bookingId)
    .single()

  if (error || !booking) return { ok: false, reason: 'Booking not found' }

  // Food only — this supplier doesn't handle drinks (those are stocked on the boat).
  const cateringItems = filterFoodItems(booking.extras_selected as never)
  if (cateringItems.length === 0) return { ok: false, reason: 'No food items on this booking' }

  const isResend = !!booking.catering_email_sent_at

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

  // Update FareHarbor booking note with catering details (best-effort)
  if (booking.booking_uuid) {
    try {
      const allExtras = (booking.extras_selected ?? []) as unknown as ExtrasLineItem[]
      const note = buildFHBookingNote(booking.guest_note, allExtras)
      if (note) {
        const fh = getFareHarborClient()
        await fh.updateBookingNote(booking.booking_uuid, note)
      }
    } catch (err) {
      console.error('[send-catering-email] FH note update failed:', err)
    }
  }

  // Always update the sent timestamp so we know when the last send was
  const { error: updateErr } = await supabase
    .from('bookings')
    .update({ catering_email_sent_at: new Date().toISOString() })
    .eq('id', bookingId)

  if (updateErr) return { ok: false, reason: updateErr.message }

  return { ok: true, resent: isResend, recipient }
}
