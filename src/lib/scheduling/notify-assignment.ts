import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { postSlackDM } from '@/lib/slack/send-notification'
import { postDm } from '@/lib/slack/bot'
import { formatAmsterdamTime } from '@/lib/utils'
import { shiftCostCents, fmtCostEuros } from './shift-cost'

/**
 * "🧑‍✈️ Joris assigned: Sat 21 Jun 14:00–16:00 · Diana"
 *
 * DMs the assigned captain directly when they have a Slack account on file
 * (crew-call time, shift window, boat, and what the shift pays).
 *
 * Two routing rules, both deliberate:
 *  - staff.slack_notifications_enabled === false means this person is never
 *    messaged by the automation. They can still be assigned shifts; only the
 *    messaging is off. Beer's own DM gets told instead, so an assignment is
 *    never silently unannounced.
 *  - the fallback (no Slack id on file, or the DM failed) goes to Beer's DM,
 *    NOT the shared #bookings channel. A crew-rostering message is internal
 *    ops; posting it to the shared channel put it in front of everyone who
 *    reads #bookings. See the Slack routing note in CLAUDE.md.
 *
 * Best-effort throughout: a missing shift just no-ops, Slack failures never throw.
 */
export async function notifyShiftAssigned(
  supabase: SupabaseClient<Database>,
  shiftId: string,
): Promise<void> {
  const { data } = await supabase
    .from('shifts')
    .select('start_at, end_at, staff(name, slack_member_id, hourly_rate_cents, slack_notifications_enabled), boats(name)')
    .eq('id', shiftId)
    .single()
  if (!data?.staff || !data.boats) return

  const day = new Date(data.start_at).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Amsterdam',
  })
  const crewCall = new Date(new Date(data.start_at).getTime() - 60 * 60_000).toISOString()
  const cost = shiftCostCents(data.staff.hourly_rate_cents, data.start_at, data.end_at)

  // Opted out of automated messages — tell Beer instead of them, and stop.
  if (data.staff.slack_notifications_enabled === false) {
    await postSlackDM(
      `🧑‍✈️ ${data.staff.name} assigned: ${day} ${formatAmsterdamTime(data.start_at)}–${formatAmsterdamTime(data.end_at)} · ${data.boats.name} · ${fmtCostEuros(cost)} (not messaged — Slack notifications are off for them)`,
    )
    return
  }

  const dmSent = data.staff.slack_member_id
    ? await postDm(
        data.staff.slack_member_id,
        `🧑‍✈️ You're on for ${day}\n` +
          `Crew call: ${formatAmsterdamTime(crewCall)} · Departure–return: ${formatAmsterdamTime(data.start_at)}–${formatAmsterdamTime(data.end_at)}\n` +
          `Boat: ${data.boats.name}\n` +
          `Pay: ${fmtCostEuros(cost)}`,
        { type: 'shift-assigned-dm', triggeredBy: 'schedule' },
      )
    : false
  if (dmSent) return

  // Falls back for two distinct reasons — say which one, so whoever reads
  // this in Slack knows whether to add a slack_member_id or check the bot
  // token, instead of assuming the captain was told and closing the loop.
  const reason = data.staff.slack_member_id ? 'DM failed — check SLACK_BOT_TOKEN' : 'no Slack ID on file — couldn\'t DM'
  await postSlackDM(
    `🧑‍✈️ ${data.staff.name} assigned: ${day} ${formatAmsterdamTime(data.start_at)}–${formatAmsterdamTime(data.end_at)} · ${data.boats.name} (${reason})`,
  )
}
