import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatReviewSms } from '@/lib/sms/format-message'
import { sendTwilioSms, normalizePhoneNumber } from '@/lib/twilio/client'
import { SITE_MAP_URL, reviewUrlForBooking } from '@/lib/sms/urls'
import { postSlackOps } from '@/lib/slack/send-notification'
import { notifyBookingsChanged } from '@/lib/realtime/notify-bookings-changed'

// Vercel Hobby plan caps cron frequency at once/day (see pending-fh-sweep for the
// same lesson learned the hard way) — so this can't rely on a tight rolling window
// to catch bookings soon after their cruise ends. Instead it looks back far enough
// to survive a missed run, and `review_sms_sent_at` guards against double-sending
// no matter how many times a booking falls inside the window across runs.
const LOOKBACK_MS = 48 * 60 * 60 * 1000

const ADMIN_REVIEWS_URL = 'https://offcourseamsterdam.com/admin/reviews'

/**
 * GET /api/cron/post-cruise-sms — Vercel Cron, once daily.
 *
 * Finds bookings whose cruise ended within the lookback window and haven't had
 * a review SMS sent yet. When `review_sms_auto_send` is on, sends immediately
 * via Twilio. Otherwise (default), posts a Slack DM proposal to Beer listing
 * each finished cruise with a link into /admin/reviews, where the "Ready to
 * send" list sends it.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  const supabase = createAdminClient()

  const nowIso = new Date().toISOString()
  const windowStartIso = new Date(Date.now() - LOOKBACK_MS).toISOString()

  const [bookingsRes, configRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('id, customer_name, customer_phone, listing_title, end_time')
      .in('status', ['confirmed', 'booked'])
      .is('review_sms_sent_at', null)
      .not('end_time', 'is', null)
      .lte('end_time', nowIso)
      .gte('end_time', windowStartIso)
      .order('end_time', { ascending: true }),
    supabase
      .from('google_reviews_config')
      .select('review_sms_enabled, review_sms_auto_send, review_sms_template')
      .limit(1)
      .maybeSingle(),
  ])

  if (bookingsRes.error) {
    await postSlackOps(`🚨 *post-cruise-sms FAILED* — could not query bookings: ${bookingsRes.error.message}`)
    return NextResponse.json({ ok: false, error: bookingsRes.error.message }, { status: 500 })
  }
  if (configRes.error) {
    await postSlackOps(`🚨 *post-cruise-sms FAILED* — could not query reviews config: ${configRes.error.message}`)
    return NextResponse.json({ ok: false, error: configRes.error.message }, { status: 500 })
  }

  const config = configRes.data
  if (!config?.review_sms_enabled) {
    return NextResponse.json({ ok: true, skipped: 'review_sms_enabled is false', checked: 0, sent: 0, proposed: 0 })
  }

  const bookings = bookingsRes.data ?? []
  if (bookings.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, sent: 0, proposed: 0 })
  }

  let sentCount = 0
  const proposalLines: string[] = []
  const errorLines: string[] = []

  for (const booking of bookings) {
    const message = formatReviewSms({
      customerName: booking.customer_name,
      listingTitle: booking.listing_title,
      mapUrl: SITE_MAP_URL,
      reviewUrl: reviewUrlForBooking(booking.id),
      template: config.review_sms_template,
    })

    if (!config.review_sms_auto_send) {
      proposalLines.push(`🛥️ *${booking.customer_name ?? 'Guest'}* — ${booking.listing_title ?? 'cruise'}`)
      continue
    }

    const normalizedPhone = normalizePhoneNumber(booking.customer_phone || '')
    if (!normalizedPhone) {
      errorLines.push(`${booking.customer_name ?? booking.id}: invalid/missing phone number`)
      continue
    }

    const sendResult = await sendTwilioSms({ to: normalizedPhone, body: message })
    if (!sendResult.success) {
      errorLines.push(`${booking.customer_name ?? booking.id}: ${sendResult.error}`)
      continue
    }

    const sentAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        review_sms_sent_at: sentAt,
        review_sms_phone: normalizedPhone,
        review_sms_sid: sendResult.sid || null,
        updated_at: sentAt,
      })
      .eq('id', booking.id)

    if (updateError) {
      errorLines.push(`${booking.customer_name ?? booking.id}: sent but failed to record (${updateError.message})`)
      continue
    }

    sentCount++
  }

  if (config.review_sms_auto_send) {
    if (sentCount > 0 || errorLines.length > 0) {
      const parts = [`✅ *Post-cruise review SMS* — sent ${sentCount}`]
      if (errorLines.length > 0) parts.push(`⚠️ ${errorLines.length} failed:\n${errorLines.join('\n')}`)
      await postSlackOps(parts.join('\n\n'))
    }
  } else if (proposalLines.length > 0) {
    await postSlackOps(
      `🛥️ *${proposalLines.length} cruise${proposalLines.length === 1 ? '' : 's'} finished* — review SMS ready to send:\n\n` +
        `${proposalLines.join('\n')}\n\n` +
        `Open ${ADMIN_REVIEWS_URL} — they're in the "Ready to send" list.`
    )
  }

  if (sentCount > 0) await notifyBookingsChanged().catch(() => {})

  return NextResponse.json({
    ok: true,
    checked: bookings.length,
    sent: sentCount,
    proposed: proposalLines.length,
    errors: errorLines.length,
  })
}
