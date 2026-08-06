import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { postSlackText } from '@/lib/slack/send-notification'
import { postDm } from '@/lib/slack/bot'
import { formatAmsterdamTime } from '@/lib/utils'
import { shiftCostCents, fmtCostEuros } from './shift-cost'

/**
 * "🧑‍✈️ Joris assigned: Sat 21 Jun 14:00–16:00 · Diana"
 *
 * DMs the assigned captain directly when they have a Slack account on file
 * (crew-call time, shift window, boat, and what the shift pays) — falls back
 * to the shared channel post when they don't, so nobody's assignment goes
 * unannounced just because their slack_member_id hasn't been set yet.
 * Best-effort throughout: a missing shift just no-ops, Slack failures never throw.
 */
export async function notifyShiftAssigned(
  supabase: SupabaseClient<Database>,
  shiftId: string,
): Promise<void> {
  const { data } = await supabase
    .from('shifts')
    .select('start_at, end_at, staff(name, slack_member_id, hourly_rate_cents), boats(name)')
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
  await postSlackText(
    `🧑‍✈️ ${data.staff.name} assigned: ${day} ${formatAmsterdamTime(data.start_at)}–${formatAmsterdamTime(data.end_at)} · ${data.boats.name} (${reason})`,
  )
}
