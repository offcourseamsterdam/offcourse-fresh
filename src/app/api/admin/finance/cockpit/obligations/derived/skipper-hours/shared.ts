/**
 * Shared loader for the skipper-hours derived-obligation routes (GET/POST here
 * and GET .../payout-run). Not a route file itself — Next.js only treats
 * `route.ts` as an endpoint, so this plain module lives alongside them safely.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { SkipperBonus, SkipperRate, SkipperShift, SkipperTimeEntry } from '@/lib/finance/cockpit/derived/skipper-hours'

type Admin = SupabaseClient<Database>

export interface SkipperAccrualInputs {
  shifts: SkipperShift[]
  timeEntries: SkipperTimeEntry[]
  bonuses: SkipperBonus[]
  staff: SkipperRate[]
}

/** Loads everything accrueSkipperHours() needs for shifts/entries/bonuses from `since` onward, plus every staff member (for names and current rates). */
export async function loadSkipperAccrualInputs(supabase: Admin, since: string): Promise<SkipperAccrualInputs> {
  const [shiftsRes, timeEntriesRes, bonusesRes, staffRes] = await Promise.all([
    supabase.from('shifts').select('id, staff_id, date, start_at, end_at, status').gte('date', since),
    supabase.from('time_entries').select('id, staff_id, shift_id, clock_in_at, clock_out_at, hourly_rate_cents').gte('clock_in_at', since),
    supabase.from('extra_hours_bonuses').select('id, staff_id, date, commission_cents').gte('date', since),
    supabase.from('staff').select('id, name, hourly_rate_cents, is_active'),
  ])
  if (shiftsRes.error) throw new Error(shiftsRes.error.message)
  if (timeEntriesRes.error) throw new Error(timeEntriesRes.error.message)
  if (bonusesRes.error) throw new Error(bonusesRes.error.message)
  if (staffRes.error) throw new Error(staffRes.error.message)

  return {
    shifts: (shiftsRes.data ?? []).map(s => ({ id: s.id, staffId: s.staff_id, date: s.date, startAt: s.start_at, endAt: s.end_at, status: s.status })),
    timeEntries: (timeEntriesRes.data ?? []).map(e => ({
      id: e.id, staffId: e.staff_id, shiftId: e.shift_id, clockInAt: e.clock_in_at, clockOutAt: e.clock_out_at, hourlyRateCents: e.hourly_rate_cents,
    })),
    bonuses: (bonusesRes.data ?? []).map(b => ({ id: b.id, staffId: b.staff_id, date: b.date, commissionCents: b.commission_cents })),
    staff: (staffRes.data ?? []).map(s => ({ id: s.id, name: s.name, hourlyRateCents: s.hourly_rate_cents, isActive: s.is_active })),
  }
}
