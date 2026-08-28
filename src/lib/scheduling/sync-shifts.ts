import type { createAdminClient } from '@/lib/supabase/admin'
import {
  generateShiftsFromBookings,
  type SyncBooking,
  type SyncShift,
} from '@/lib/scheduling/generate-shifts'

type AdminClient = ReturnType<typeof createAdminClient>

const BOOKING_COLS =
  'id, booking_date, start_time, end_time, status, category, customer_type_name, fareharbor_availability_pk'

/** A shift row plus the departures it covers (shift_bookings). */
const SHIFT_COLS = 'id, date, start_at, end_at, boat_id, status, shift_bookings(booking_id)'

interface ShiftRow {
  id: string
  date: string
  start_at: string
  end_at: string
  boat_id: string
  status: string
  shift_bookings: { booking_id: string }[] | null
}

export interface SyncShiftsResult {
  created: number
  updated: number
  skipped: unknown[]
}

/**
 * Pulls bookings + shifts for [from, to], runs the pure generator, applies the
 * result. Shared by the manual admin sync route and the ghost-ops cron (which
 * runs it before drafting so the ops-review agent never scores a stale shift
 * roster — see docs/features/ai-operations-engine.md).
 *
 * Membership (which departures a shift covers) lives in shift_bookings and is
 * reconciled here alongside the shift row itself — see generate-shifts.ts for
 * why a shift can cover several departures at all.
 */
export async function syncShiftsForRange(
  supabase: AdminClient,
  from: string,
  to: string,
): Promise<SyncShiftsResult | { error: string }> {
  const [bookingsRes, shiftsRes, boatsRes] = await Promise.all([
    supabase.from('bookings').select(BOOKING_COLS).gte('booking_date', from).lte('booking_date', to),
    supabase.from('shifts').select(SHIFT_COLS).gte('date', from).lte('date', to),
    supabase.from('boats').select('id, name'),
  ])
  if (bookingsRes.error) return { error: bookingsRes.error.message }
  if (shiftsRes.error) return { error: shiftsRes.error.message }
  if (boatsRes.error) return { error: boatsRes.error.message }

  const bookings: SyncBooking[] = bookingsRes.data
  const shifts: SyncShift[] = (shiftsRes.data as unknown as ShiftRow[]).map(s => ({
    id: s.id,
    date: s.date,
    start_at: s.start_at,
    end_at: s.end_at,
    boat_id: s.boat_id,
    status: s.status,
    booking_ids: (s.shift_bookings ?? []).map(sb => sb.booking_id),
  }))

  // Departures covered by an in-range shift whose booking the date query
  // missed — the booking was moved to another day. Without these the
  // generator would think the shift's departures had vanished and cancel it.
  const haveIds = new Set(bookings.map(b => b.id))
  const missingIds = [...new Set(shifts.flatMap(s => s.booking_ids))].filter(id => !haveIds.has(id))
  if (missingIds.length > 0) {
    const extra = await supabase.from('bookings').select(BOOKING_COLS).in('id', missingIds)
    if (extra.error) return { error: extra.error.message }
    bookings.push(...extra.data)
  }

  const { toCreate, toUpdate, skipped } = generateShiftsFromBookings(bookings, shifts, boatsRes.data)

  // ── Create: the shift row, then the departures it covers ──────────────
  for (const c of toCreate) {
    const { booking_ids, ...row } = c
    const { data: inserted, error } = await supabase.from('shifts').insert(row).select('id').single()
    if (error) return { error: error.message }
    if (booking_ids.length > 0) {
      const { error: linkError } = await supabase
        .from('shift_bookings')
        .insert(booking_ids.map(booking_id => ({ shift_id: inserted.id, booking_id })))
      if (linkError) return { error: linkError.message }
    }
  }

  // ── Update: row changes, then reconcile membership ────────────────────
  const existingById = new Map(shifts.map(s => [s.id, s]))
  for (const u of toUpdate) {
    if (Object.keys(u.changes).length > 0) {
      const { error } = await supabase.from('shifts').update(u.changes).eq('id', u.id)
      if (error) return { error: error.message }
    }

    const before = new Set(existingById.get(u.id)?.booking_ids ?? [])
    const after = new Set(u.booking_ids)
    const added = [...after].filter(id => !before.has(id))
    const removed = [...before].filter(id => !after.has(id))

    if (added.length > 0) {
      const { error } = await supabase
        .from('shift_bookings')
        .insert(added.map(booking_id => ({ shift_id: u.id, booking_id })))
      if (error) return { error: error.message }
    }
    if (removed.length > 0) {
      const { error } = await supabase
        .from('shift_bookings')
        .delete()
        .eq('shift_id', u.id)
        .in('booking_id', removed)
      if (error) return { error: error.message }
    }
  }

  return { created: toCreate.length, updated: toUpdate.length, skipped }
}
