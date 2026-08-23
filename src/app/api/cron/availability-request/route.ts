import { NextResponse, type NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { alertCronFailure } from '@/lib/cron/alert'
import { createAdminClient } from '@/lib/supabase/admin'
import { postDm } from '@/lib/slack/bot'
import { postSlackText } from '@/lib/slack/send-notification'
import { checkAvailabilityRequest, checkAvailabilityReminder } from '@/lib/scheduling/availability-request'
import { getMonthAvailabilityStatus, captainAvailabilityUrl, type CaptainMonthStatus } from '@/lib/scheduling/availability-status'
import { emitOpsEvent } from '@/lib/ops/events'

/**
 * GET /api/cron/availability-request
 *
 * Runs daily (see vercel.json). A no-op on every day except two per month:
 *   - AVAILABILITY_REQUEST_LEAD_DAYS before a month starts → the first ask,
 *     to every active captain.
 *   - AVAILABILITY_REMINDER_LEAD_DAYS before it → a follow-up nudge, to
 *     captains who STILL have nothing filled in for that month.
 * Each date match is its own guard (every month has exactly one date that
 * many days before it), so neither needs separate "already sent" tracking.
 *
 * Both messages carry a real link to the captain's own calendar — Beer,
 * 2026-08-23: the original DM said "head to your availability calendar"
 * with no URL in it at all.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    // The first ask wins if both somehow land on one day (impossible while
    // the two lead constants differ, but the ordering makes that explicit
    // rather than relying on it).
    const first = checkAvailabilityRequest()
    const followUp = first ? null : checkAvailabilityReminder()
    const check = first ?? followUp
    if (!check) return NextResponse.json({ ok: true, sent: 0, reason: 'not a trigger day' })
    const isFollowUp = !first

    const supabase = createAdminClient()
    let captains: CaptainMonthStatus[]
    try {
      captains = await getMonthAvailabilityStatus(supabase, check.targetMonth)
    } catch (err) {
      await alertCronFailure('availability-request', err)
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }

    const monthLabel = new Date(`${check.targetMonthStart}T12:00:00Z`).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Amsterdam',
    })
    const url = captainAvailabilityUrl(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com')
    const message = isFollowUp
      ? `📅 Quick nudge — we still don't have your availability for ${monthLabel}. ` +
        `Mark the days that work for you here: ${url}`
      : `📅 Time to fill in your availability for ${monthLabel} — ` +
        `mark which days work for you here: ${url}`

    // The follow-up only ever goes to captains who haven't responded; the
    // first ask goes to everyone.
    const audience = isFollowUp ? captains.filter(c => !c.hasResponded) : captains

    let sent = 0
    let noSlackId = 0
    let optedOut = 0
    for (const c of audience) {
      // Respect the same opt-out notify-assignment.ts honours — the original
      // version of this cron checked only for a Slack ID and would DM someone
      // who had explicitly turned notifications off (Beer, 2026-08-23).
      if (!c.slackNotificationsEnabled) {
        optedOut++
        continue
      }
      if (!c.slackMemberId) {
        noSlackId++
        continue
      }
      const ok = await postDm(c.slackMemberId, message, {
        type: isFollowUp ? 'availability-reminder-dm' : 'availability-request-dm',
        triggeredBy: 'schedule',
      })
      if (ok) sent++
    }

    if (noSlackId > 0) {
      await postSlackText(
        `⚠️ Availability ${isFollowUp ? 'reminder' : 'request'} for ${monthLabel}: ${noSlackId} captain(s) have no Slack ID on file, couldn't DM them.`,
      )
    }
    // A follow-up day with nobody left to chase is worth saying out loud —
    // silence there is indistinguishable from the cron not running.
    if (isFollowUp && audience.length === 0) {
      await postSlackText(`✅ Everyone has filled in their availability for ${monthLabel} — no reminders needed.`)
    }

    await emitOpsEvent({
      eventType: 'availability_request_sent',
      actorType: 'system',
      source: 'cron/availability-request',
      payload: { targetMonth: check.targetMonth, sent, noSlackId, optedOut, isFollowUp },
    })

    return NextResponse.json({ ok: true, targetMonth: check.targetMonth, isFollowUp, sent, noSlackId, optedOut })
  } catch (err) {
    await alertCronFailure('availability-request', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
