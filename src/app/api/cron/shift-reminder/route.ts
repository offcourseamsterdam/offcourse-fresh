import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { postDm, postToChannel } from '@/lib/slack/bot'
import { formatAmsterdamTime } from '@/lib/utils'

/**
 * Shift reminder cron — called every 5 minutes by Vercel (requires Pro plan)
 * or an external cron service pointed at this endpoint.
 *
 * Finds shifts starting in the next 5–10 minutes where the assigned captain
 * hasn't checked in yet, and sends them a Slack reminder.
 *
 * Vercel protects cron routes with a Bearer token it injects automatically:
 *   Authorization: Bearer $CRON_SECRET
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const supabase = createAdminClient()

  const now = new Date()
  // Window: shifts starting between now+4min and now+11min (gives ~5min slack either side)
  const windowStart = new Date(now.getTime() + 4 * 60 * 1000).toISOString()
  const windowEnd   = new Date(now.getTime() + 11 * 60 * 1000).toISOString()

  const { data: shifts, error } = await supabase
    .from('shifts')
    .select('id, start_at, end_at, staff_id, staff(name, slack_member_id), boats(name)')
    .in('status', ['assigned', 'confirmed'])
    .gte('start_at', windowStart)
    .lte('start_at', windowEnd)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!shifts?.length) return NextResponse.json({ reminded: 0 })

  // Exclude captains who already checked in
  const staffIds = shifts.map(s => s.staff_id).filter(Boolean) as string[]
  const { data: openEntries } = await supabase
    .from('time_entries')
    .select('staff_id')
    .in('staff_id', staffIds)
    .is('clock_out_at', null)
  const alreadyIn = new Set((openEntries ?? []).map(e => e.staff_id))

  const opsChannel = process.env.SLACK_OPS_CHANNEL ?? '#bookings'
  let reminded = 0

  for (const shift of shifts) {
    if (!shift.staff_id || alreadyIn.has(shift.staff_id)) continue
    const staffName = shift.staff?.name ?? 'Captain'
    const boatName  = shift.boats?.name ?? 'your boat'
    const msg = `⏰ ${staffName}, your shift starts at ${formatAmsterdamTime(shift.start_at)} (${boatName}). Time to check in!`

    const memberId = shift.staff?.slack_member_id
    if (memberId) {
      await postDm(memberId, msg)
    } else {
      await postToChannel(opsChannel, msg)
    }
    reminded++
  }

  return NextResponse.json({ reminded })
}
