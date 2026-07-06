import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasFood } from '@/lib/catering/filter'
import { cateringAutoSendCutoffDate } from '@/lib/catering/auto-send-cutoff'
import { sendCateringOrderEmailForBooking } from '@/lib/catering/send-catering-email'
import { alertCronFailure } from '@/lib/cron/alert'

/**
 * GET /api/cron/catering-auto-send
 * Vercel Cron: runs daily at 08:30 UTC.
 *
 * Auto-sends the catering order email to the supplier once a booking's
 * departure is 7 days away or less. Bookings made further out than that stay
 * queued (visible as "pending" on the admin catering dashboard) so the
 * supplier isn't notified about orders that might still change — bookings
 * made WITHIN 7 days of departure are already inside the window the very
 * first time this cron sees them, so they go out on the next run same as a
 * long-lead booking that just crossed the 7-day mark. One cron, one rule.
 *
 * Skips bookings where catering_email_sent_at is already set (no double-sends;
 * the admin "resend" button remains the only way to send again).
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  const supabase = createAdminClient()
  const cutoffDate = cateringAutoSendCutoffDate(7)

  const { data: candidates, error } = await supabase
    .from('bookings')
    .select('id, extras_selected')
    .in('status', ['confirmed', 'booked'])
    .lte('booking_date', cutoffDate)
    .is('catering_email_sent_at', null)

  if (error) {
    await alertCronFailure('catering-auto-send', error, 'DB query for eligible bookings failed')
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // Food only — this supplier doesn't handle drinks (those are stocked on the boat).
  const eligible = (candidates ?? []).filter(b => hasFood(b.extras_selected as never))

  let sent = 0
  let failed = 0
  for (const booking of eligible) {
    const result = await sendCateringOrderEmailForBooking(booking.id)
    if (result.ok) {
      sent++
    } else {
      failed++
      console.error('[cron/catering-auto-send] failed for booking', booking.id, result.reason)
    }
  }

  return NextResponse.json({ ok: true, checked: eligible.length, sent, failed })
}
