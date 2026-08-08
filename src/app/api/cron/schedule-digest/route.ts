import { NextResponse, type NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { alertCronFailure } from '@/lib/cron/alert'
import { createAdminClient } from '@/lib/supabase/admin'
import { postDm } from '@/lib/slack/bot'
import { postSlackText } from '@/lib/slack/send-notification'
import { emitOpsEvent } from '@/lib/ops/events'
import { amsterdamToday } from '@/lib/utils'
import { isScheduleDigestTime, buildCaptainDigests, formatDigestMessage } from '@/lib/scheduling/schedule-digest'

/**
 * GET /api/cron/schedule-digest
 *
 * Runs every 15 minutes (see vercel.json); a no-op outside the digest hour
 * (see isScheduleDigestTime — DST-safe, unlike a fixed-UTC cron time).
 * Once per day, inside that window, DMs each captain with an assigned shift
 * tomorrow a one-message summary of their day — the "here's your schedule"
 * digest that didn't exist before (only per-shift assignment DMs and the
 * 5-10-min pre-shift reminder did).
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  if (!isScheduleDigestTime()) return NextResponse.json({ ok: true, sent: 0, reason: 'not the digest hour' })

  try {
    const supabase = createAdminClient()
    const tomorrow = amsterdamToday(1)

    const { data: shifts, error } = await supabase
      .from('shifts')
      .select('staff_id, start_at, end_at, staff(name, slack_member_id), boats(name)')
      .eq('date', tomorrow)
      .in('status', ['assigned', 'confirmed'])

    if (error) {
      await alertCronFailure('schedule-digest', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const digests = buildCaptainDigests(shifts ?? [])
    const dayLabel = new Date(`${tomorrow}T12:00:00Z`).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/Amsterdam',
    })

    let sent = 0
    let noSlackId = 0
    for (const digest of digests) {
      if (!digest.slackMemberId) {
        noSlackId++
        continue
      }
      const ok = await postDm(digest.slackMemberId, formatDigestMessage(dayLabel, digest.shifts), {
        type: 'schedule-digest-dm',
        triggeredBy: 'schedule',
      })
      if (ok) sent++
    }

    if (noSlackId > 0) {
      await postSlackText(`⚠️ Schedule digest for ${dayLabel}: ${noSlackId} captain(s) have no Slack ID on file, couldn't DM them.`)
    }

    await emitOpsEvent({
      eventType: 'schedule_digest_sent',
      actorType: 'system',
      source: 'cron/schedule-digest',
      payload: { date: tomorrow, sent, noSlackId, captainsWithShifts: digests.length },
    })

    return NextResponse.json({ ok: true, date: tomorrow, sent, noSlackId })
  } catch (err) {
    await alertCronFailure('schedule-digest', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
