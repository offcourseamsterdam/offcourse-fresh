import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { postSlackText } from '@/lib/slack/send-notification'
import { formatAmsterdamTime } from '@/lib/utils'

/**
 * "🧑‍✈️ Joris assigned: Sat 21 Jun 14:00–16:00 · Diana"
 *
 * Channel message in v1; the per-captain DM arrives with the Slack bot (M4).
 * Best-effort: postSlackText never throws, and a missing shift just no-ops.
 */
export async function notifyShiftAssigned(
  supabase: SupabaseClient<Database>,
  shiftId: string,
): Promise<void> {
  const { data } = await supabase
    .from('shifts')
    .select('start_at, end_at, staff(name), boats(name)')
    .eq('id', shiftId)
    .single()
  if (!data?.staff || !data.boats) return

  const day = new Date(data.start_at).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Amsterdam',
  })
  await postSlackText(
    `🧑‍✈️ ${data.staff.name} assigned: ${day} ${formatAmsterdamTime(data.start_at)}–${formatAmsterdamTime(data.end_at)} · ${data.boats.name}`,
  )
}
