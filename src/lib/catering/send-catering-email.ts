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
import { emitOpsEvent } from '@/lib/ops/events'
import { filterFoodItems, type ExtrasLineItem } from './filter'
import { buildCateringEmailText, buildCateringEmailSubject } from './email-template'
import { buildFHBookingNote } from './build-fh-note'
import { resolveCateringEmailRecipient } from './recipient'
import { postSlackText } from '@/lib/slack/send-notification'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { formatAmsterdamTime } from '@/lib/utils'
import { sendNewEmail } from '@/lib/gmail/client'

export type SendCateringEmailResult =
  | { ok: true; resent: boolean; recipient: string }
  | { ok: false; reason: string }

export async function sendCateringOrderEmailForBooking(bookingId: string): Promise<SendCateringEmailResult> {
  const supabase = createAdminClient()
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`
      id, booking_uuid, customer_name, listing_title, tour_item_name, listing_id,
      booking_date, start_time, guest_count, category,
      extras_selected, catering_email_sent_at, catering_thread_id, guest_note
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

  const recipient = await resolveCateringEmailRecipient(booking.listing_id)
  const subject = buildCateringEmailSubject(cruiseName, booking.booking_date, booking.start_time)

  // Sending via Gmail (unlike the old Resend path) can throw — a missing/expired
  // GMAIL_REFRESH_TOKEN, or a transient Gmail API error — and this function's
  // own return type promises callers a result, never an exception. The daily
  // catering-auto-send cron loops over every eligible booking with no
  // try/catch of its own (relying on exactly that promise); an uncaught throw
  // here would abort that loop and silently skip every remaining booking in
  // the batch, not just this one.
  let sentThreadId: string | null
  try {
    // On a resend, reuse the existing Gmail thread so a supplier reply lands
    // where catering_thread_id already points — otherwise the reply would land
    // in a brand-new thread that nothing recognizes as belonging to this
    // booking. A fresh send has no thread yet; Gmail mints one and we capture
    // it below.
    ;({ threadId: sentThreadId } = await sendNewEmail({
      to: recipient,
      subject: isResend ? `[UPDATED] ${subject}` : subject,
      body: text,
      threadId: isResend ? booking.catering_thread_id : undefined,
    }))
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Failed to send catering email via Gmail' }
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

  // Always update the sent timestamp so we know when the last send was, and
  // record the Gmail thread id — same value as before on a same-thread
  // resend, newly captured on a fresh send — so the inbox sync can recognize
  // a supplier's reply as belonging to this booking.
  const { error: updateErr } = await supabase
    .from('bookings')
    .update({ catering_email_sent_at: new Date().toISOString(), catering_thread_id: sentThreadId })
    .eq('id', bookingId)

  if (updateErr) return { ok: false, reason: updateErr.message }

  await emitOpsEvent({
    eventType: 'catering_order_sent',
    actorType: 'system',
    bookingId,
    payload: { resent: isResend, recipient },
    source: 'catering/send-catering-email',
  })

  return { ok: true, resent: isResend, recipient }
}
