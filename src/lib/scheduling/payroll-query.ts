import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

/**
 * The one place that defines "time entries for a payroll period": entries
 * whose clock-in falls inside [from, to] (whole days, UTC bounds — the
 * Amsterdam day-boundary blur is acceptable for periods spanning weeks),
 * plus the staff list to label them. Used by the payroll API and the CSV
 * export so the two can never drift apart.
 */
export async function fetchPayrollRange(
  supabase: SupabaseClient<Database>,
  from: string,
  to: string,
) {
  const [entriesRes, staffRes, bonusesRes] = await Promise.all([
    supabase
      .from('time_entries')
      .select('id, staff_id, clock_in_at, clock_out_at, hourly_rate_cents, flag, source, note, shift_id')
      .gte('clock_in_at', `${from}T00:00:00.000Z`)
      .lte('clock_in_at', `${to}T23:59:59.999Z`)
      .order('clock_in_at', { ascending: true }),
    supabase.from('staff').select('id, name, role').order('name', { ascending: true }),
    supabase
      .from('review_bonuses')
      .select('staff_id, amount_cents')
      .gte('awarded_at', `${from}T00:00:00.000Z`)
      .lte('awarded_at', `${to}T23:59:59.999Z`),
  ])
  if (entriesRes.error) throw new Error(entriesRes.error.message)
  if (staffRes.error) throw new Error(staffRes.error.message)

  return {
    entries: entriesRes.data ?? [],
    staff: staffRes.data ?? [],
    bonuses: bonusesRes.data ?? [],
  }
}
