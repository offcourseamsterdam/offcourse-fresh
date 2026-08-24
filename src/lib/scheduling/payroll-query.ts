import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

/**
 * The one place that defines "time entries for a payroll period": entries
 * whose clock-in falls inside [from, to] (whole days, UTC bounds — the
 * Amsterdam day-boundary blur is acceptable for periods spanning weeks),
 * plus the staff list to label them. Used by the payroll API and the CSV
 * export so the two can never drift apart.
 *
 * review_bonuses are bucketed by awarded_at (when the AI matcher found the
 * mention), not the review's own date — and excluded_from_payroll=false
 * filters out the 2026-08-22/23 backfill scan's ~55 retroactive awards
 * (Beer: "we wont pay out bonuses this month") without touching bonuses
 * awarded normally going forward.
 *
 * extra_hours_bonuses (Beer, 2026-08-24: 50% commission on an on-the-water
 * upsell) are bucketed by their own `date` — unlike a review bonus, there's
 * no AI-matched-it-later delay, so the date IS the event.
 */
export async function fetchPayrollRange(
  supabase: SupabaseClient<Database>,
  from: string,
  to: string,
) {
  const [entriesRes, staffRes, bonusesRes, extraHoursRes] = await Promise.all([
    supabase
      .from('time_entries')
      .select('id, staff_id, clock_in_at, clock_out_at, hourly_rate_cents, flag, source, note, shift_id')
      .gte('clock_in_at', `${from}T00:00:00.000Z`)
      .lte('clock_in_at', `${to}T23:59:59.999Z`)
      .order('clock_in_at', { ascending: true }),
    supabase.from('staff').select('id, name, role').order('name', { ascending: true }),
    supabase
      .from('review_bonuses')
      .select('id, staff_id, amount_cents, awarded_at, social_proof_reviews(rating)')
      .eq('excluded_from_payroll', false)
      .gte('awarded_at', `${from}T00:00:00.000Z`)
      .lte('awarded_at', `${to}T23:59:59.999Z`),
    supabase
      .from('extra_hours_bonuses')
      .select('id, staff_id, date, extra_minutes, amount_charged_cents, commission_cents, note')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
  ])
  if (entriesRes.error) throw new Error(entriesRes.error.message)
  if (staffRes.error) throw new Error(staffRes.error.message)

  return {
    entries: entriesRes.data ?? [],
    staff: staffRes.data ?? [],
    bonuses: bonusesRes.data ?? [],
    extraHoursBonuses: extraHoursRes.data ?? [],
  }
}
