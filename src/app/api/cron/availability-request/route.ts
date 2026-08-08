import { NextResponse, type NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { alertCronFailure } from '@/lib/cron/alert'
import { createAdminClient } from '@/lib/supabase/admin'
import { postDm } from '@/lib/slack/bot'
import { postSlackText } from '@/lib/slack/send-notification'
import { checkAvailabilityRequest } from '@/lib/scheduling/availability-request'
import { emitOpsEvent } from '@/lib/ops/events'

/**
 * GET /api/cron/availability-request
 *
 * Runs daily (see vercel.json). A no-op on every day except the one exact
 * date AVAILABILITY_REQUEST_LEAD_DAYS before a month starts (see
 * checkAvailabilityRequest — that date match is the only guard needed, no
 * separate "already sent" tracking, since each month has exactly one
 * trigger date). On that day, DMs every active captain asking them to fill
 * in availability for the upcoming month.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    const check = checkAvailabilityRequest()
    if (!check) return NextResponse.json({ ok: true, sent: 0, reason: 'not a trigger day' })

    const supabase = createAdminClient()
    const { data: staff, error } = await supabase
      .from('staff')
      .select('id, name, slack_member_id')
      .eq('is_active', true)

    if (error) {
      await alertCronFailure('availability-request', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const monthLabel = new Date(`${check.targetMonthStart}T12:00:00Z`).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Amsterdam',
    })
    const message =
      `📅 Time to fill in your availability for ${monthLabel} — ` +
      `head to your availability calendar and mark which days work for you.`

    let sent = 0
    let noSlackId = 0
    for (const s of staff ?? []) {
      if (!s.slack_member_id) {
        noSlackId++
        continue
      }
      const ok = await postDm(s.slack_member_id, message, { type: 'availability-request-dm', triggeredBy: 'schedule' })
      if (ok) sent++
    }

    if (noSlackId > 0) {
      await postSlackText(`⚠️ Availability request for ${monthLabel}: ${noSlackId} captain(s) have no Slack ID on file, couldn't DM them.`)
    }

    await emitOpsEvent({
      eventType: 'availability_request_sent',
      actorType: 'system',
      source: 'cron/availability-request',
      payload: { targetMonth: check.targetMonth, sent, noSlackId },
    })

    return NextResponse.json({ ok: true, targetMonth: check.targetMonth, sent, noSlackId })
  } catch (err) {
    await alertCronFailure('availability-request', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
