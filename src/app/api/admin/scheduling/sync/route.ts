import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncBodySchema } from '@/lib/scheduling/shift-schema'
import {
  generateShiftsFromBookings,
  type SyncBooking,
  type SyncShift,
} from '@/lib/scheduling/generate-shifts'

const BOOKING_COLS =
  'id, booking_date, start_time, end_time, status, category, customer_type_name, fareharbor_availability_pk'

/**
 * POST /api/admin/scheduling/sync { from, to }
 *
 * Pulls bookings + shifts for the date range, runs the pure generator,
 * applies the result. Also re-fetches the source bookings of shifts already
 * in the range (by id / departure pk) so a booking that moved OUT of the
 * range or got cancelled still updates its shift.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const parsed = syncBodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid body', 400)
    const { from, to } = parsed.data

    const supabase = createAdminClient()

    const [bookingsRes, shiftsRes, boatsRes] = await Promise.all([
      supabase.from('bookings').select(BOOKING_COLS).gte('booking_date', from).lte('booking_date', to),
      supabase
        .from('shifts')
        .select('id, booking_id, fareharbor_availability_pk, date, start_at, end_at, boat_id, status')
        .gte('date', from)
        .lte('date', to),
      supabase.from('boats').select('id, name'),
    ])
    if (bookingsRes.error) return apiError(bookingsRes.error.message)
    if (shiftsRes.error) return apiError(shiftsRes.error.message)
    if (boatsRes.error) return apiError(boatsRes.error.message)

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
      if (extra.error) return apiError(extra.error.message)
      bookings.push(...extra.data)
    }
    if (missingPks.length > 0) {
      const extra = await supabase
        .from('bookings')
        .select(BOOKING_COLS)
        .in('fareharbor_availability_pk', missingPks)
      if (extra.error) return apiError(extra.error.message)
      for (const b of extra.data) if (!haveIds.has(b.id)) bookings.push(b)
    }

    const { toCreate, toUpdate, skipped } = generateShiftsFromBookings(bookings, shifts, boatsRes.data)

    if (toCreate.length > 0) {
      const { error } = await supabase.from('shifts').insert(toCreate)
      if (error) return apiError(error.message)
    }
    for (const u of toUpdate) {
      const { error } = await supabase.from('shifts').update(u.changes).eq('id', u.id)
      if (error) return apiError(error.message)
    }

    return apiOk({ created: toCreate.length, updated: toUpdate.length, skipped })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
