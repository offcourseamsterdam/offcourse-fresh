import type { createAdminClient } from '@/lib/supabase/admin'
import {
  generateShiftsFromBookings,
  type SyncBooking,
  type SyncShift,
} from '@/lib/scheduling/generate-shifts'

type AdminClient = ReturnType<typeof createAdminClient>

const BOOKING_COLS =
  'id, booking_date, start_time, end_time, status, category, customer_type_name, fareharbor_availability_pk'

/**
 * Pulls bookings + shifts for [from, to], runs the pure generator, applies
 * the result. Shared by the manual admin sync route and the ghost-ops cron
 * (which runs it before drafting so the ops-review agent never scores a
 * stale shift roster — see docs/features/ai-operations-engine.md).
 */
export async function syncShiftsForRange(
  supabase: AdminClient,
  from: string,
  to: string,
): Promise<{ created: number; updated: number; skipped: unknown[] } | { error: string }> {
  const [bookingsRes, shiftsRes, boatsRes] = await Promise.all([
    supabase.from('bookings').select(BOOKING_COLS).gte('booking_date', from).lte('booking_date', to),
    supabase
      .from('shifts')
      .select('id, booking_id, fareharbor_availability_pk, date, start_at, end_at, boat_id, status')
      .gte('date', from)
      .lte('date', to),
    supabase.from('boats').select('id, name'),
  ])
  if (bookingsRes.error) return { error: bookingsRes.error.message }
  if (shiftsRes.error) return { error: shiftsRes.error.message }
  if (boatsRes.error) return { error: boatsRes.error.message }

  const bookings: SyncBooking[] = bookingsRes.data
  const shifts: SyncShift[] = shiftsRes.data

  // Source bookings of in-range shifts that the date query missed
  // (booking moved to another day, or linked via departure pk).
  const haveIds = new Set(bookings.map(b => b.id))
  const havePks = new Set(bookings.map(b => b.fareharbor_availability_pk).filter(Boolean))
  const missingIds = shifts.map(s => s.booking_id).filter((id): id is string => !!id && !haveIds.has(id))
  const missingPks = shifts
    .map(s => s.fareharbor_availability_pk)
    .filter((pk): pk is number => pk != null && !havePks.has(pk))

  if (missingIds.length > 0) {
    const extra = await supabase.from('bookings').select(BOOKING_COLS).in('id', missingIds)
    if (extra.error) return { error: extra.error.message }
    bookings.push(...extra.data)
  }
  if (missingPks.length > 0) {
    const extra = await supabase
      .from('bookings')
      .select(BOOKING_COLS)
      .in('fareharbor_availability_pk', missingPks)
    if (extra.error) return { error: extra.error.message }
    for (const b of extra.data) if (!haveIds.has(b.id)) bookings.push(b)
  }

  const { toCreate, toUpdate, skipped } = generateShiftsFromBookings(bookings, shifts, boatsRes.data)

  if (toCreate.length > 0) {
    const { error } = await supabase.from('shifts').insert(toCreate)
    if (error) return { error: error.message }
  }
  for (const u of toUpdate) {
    const { error } = await supabase.from('shifts').update(u.changes).eq('id', u.id)
    if (error) return { error: error.message }
  }

  return { created: toCreate.length, updated: toUpdate.length, skipped }
}
