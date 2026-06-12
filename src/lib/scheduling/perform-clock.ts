import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { decideClockIn, decideClockOut } from '@/lib/scheduling/clock'
import { amsterdamToday, formatAmsterdamTime } from '@/lib/utils'

type Staff = Pick<Database['public']['Tables']['staff']['Row'], 'id' | 'hourly_rate_cents'>
type Source = 'slack' | 'portal' | 'admin'

export interface ClockOutcome {
  /** false = nothing changed (double in / out without in) — message says why. */
  changed: boolean
  message: string
  /** present after a successful check-in */
  entryId?: string
}

/**
 * The one clock-in/out engine. Portal (M3) and Slack bot (M4) both call
 * this; the pure decision logic lives in clock.ts. Rate is snapshotted from
 * the staff row at check-in so payroll never shifts under a rate change.
 */
export async function performClock(
  supabase: SupabaseClient<Database>,
  staff: Staff,
  action: 'in' | 'out',
  source: Source,
  now = new Date(),
): Promise<ClockOutcome> {
  const { data: openEntries, error: openError } = await supabase
    .from('time_entries')
    .select('id, clock_in_at')
    .eq('staff_id', staff.id)
    .is('clock_out_at', null)
    .order('clock_in_at', { ascending: false })
    .limit(1)
  if (openError) throw new Error(openError.message)
  const openEntry = openEntries[0] ?? null

  if (action === 'out') {
    const result = decideClockOut(openEntry)
    if (!result.ok) return { changed: false, message: result.message }
    const { error } = await supabase
      .from('time_entries')
      .update({ clock_out_at: now.toISOString() })
      .eq('id', openEntry!.id)
    if (error) throw new Error(error.message)
    return {
      changed: true,
      message: `✅ Checked out ${formatAmsterdamTime(now)} — worked since ${formatAmsterdamTime(openEntry!.clock_in_at)}.`,
    }
  }

  const { data: todaysShifts, error: shiftsError } = await supabase
    .from('shifts')
    .select('id, start_at, end_at, boats(name)')
    .eq('staff_id', staff.id)
    .eq('date', amsterdamToday(0, now))
    .in('status', ['assigned', 'confirmed'])
  if (shiftsError) throw new Error(shiftsError.message)

  const result = decideClockIn(openEntry, todaysShifts, now)
  if (!result.ok) return { changed: false, message: result.message }
  if (result.decision.action !== 'create') return { changed: false, message: 'Unexpected state' }
  const decision = result.decision

  const { data: created, error: insertError } = await supabase
    .from('time_entries')
    .insert({
      staff_id: staff.id,
      shift_id: decision.shift_id,
      clock_in_at: now.toISOString(),
      source,
      hourly_rate_cents: staff.hourly_rate_cents,
      flag: decision.flag,
    })
    .select('id')
    .single()
  if (insertError) throw new Error(insertError.message)

  const matched = todaysShifts.find(s => s.id === decision.shift_id)
  const message = matched
    ? `✅ Checked in ${formatAmsterdamTime(now)} — ${matched.boats?.name ?? 'boat'} ${formatAmsterdamTime(matched.start_at)} shift.`
    : `✅ Checked in ${formatAmsterdamTime(now)}. No shift on the rota for you today — flagged for payroll review.`
  return { changed: true, message, entryId: created.id }
}
