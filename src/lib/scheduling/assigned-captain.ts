import type { createAdminClient } from '@/lib/supabase/admin'
import { extractFirstName } from '@/lib/sms/format-message'

export interface CaptainLookupBooking {
  id: string
  fareharbor_availability_pk: number | null
}

/**
 * The assigned captain's first name for each booking, keyed by booking id.
 * Bookings with no resolvable captain are simply absent from the map.
 *
 * A shift links to a booking two ways, both checked here: the `shift_bookings`
 * join table (the current mechanism — one shift covering a captain's whole
 * back-to-back block of tours can link to several bookings, e.g. a private
 * cruise immediately followed by a shared one) and the legacy `shifts.booking_id`
 * column (only ever the first booking of that group, kept for back-compat).
 *
 * Shared-cruise bookings (several booking rows on one FareHarbor availability
 * slot) don't each get their own `shift_bookings` row — usually only one guest
 * of the group is actually linked to the shift. So a booking that isn't
 * directly linked falls back to any *sibling* booking on the same
 * `fareharbor_availability_pk` that is, and — failing that — to a shift with
 * that `fareharbor_availability_pk` set directly on it (a small number of
 * older shifts were assigned that way, without a `shift_bookings` row at all).
 *
 * Batches every lookup (siblings, shift links, shifts, staff names) across
 * the whole input list rather than querying per booking.
 */
export async function getCaptainFirstNames(
  supabase: ReturnType<typeof createAdminClient>,
  bookings: CaptainLookupBooking[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (bookings.length === 0) return result

  const bookingIds = bookings.map(b => b.id)
  const availabilityPks = [
    ...new Set(bookings.map(b => b.fareharbor_availability_pk).filter((pk): pk is number => pk != null)),
  ]

  const siblingsRes = availabilityPks.length > 0
    ? await supabase
        .from('bookings')
        .select('id, fareharbor_availability_pk')
        .in('fareharbor_availability_pk', availabilityPks)
    : { data: [] as { id: string; fareharbor_availability_pk: number }[] }

  const siblingIdsByPk = new Map<number, string[]>()
  for (const s of siblingsRes.data ?? []) {
    if (s.fareharbor_availability_pk == null) continue
    const list = siblingIdsByPk.get(s.fareharbor_availability_pk) ?? []
    list.push(s.id)
    siblingIdsByPk.set(s.fareharbor_availability_pk, list)
  }

  const allRelevantBookingIds = [...new Set([...bookingIds, ...(siblingsRes.data ?? []).map(s => s.id)])]

  const [shiftBookingsRes, ownShiftsRes, sharedShiftsRes] = await Promise.all([
    supabase.from('shift_bookings').select('booking_id, shift_id').in('booking_id', allRelevantBookingIds),
    supabase.from('shifts').select('booking_id, staff_id').in('booking_id', allRelevantBookingIds).not('staff_id', 'is', null),
    availabilityPks.length > 0
      ? supabase
          .from('shifts')
          .select('fareharbor_availability_pk, staff_id')
          .in('fareharbor_availability_pk', availabilityPks)
          .not('staff_id', 'is', null)
      : Promise.resolve({ data: [] as { fareharbor_availability_pk: number | null; staff_id: string | null }[] }),
  ])

  const shiftIds = [...new Set((shiftBookingsRes.data ?? []).map(r => r.shift_id))]
  const shiftsRes = shiftIds.length > 0
    ? await supabase.from('shifts').select('id, staff_id').in('id', shiftIds).not('staff_id', 'is', null)
    : { data: [] as { id: string; staff_id: string | null }[] }
  const staffIdByShiftId = new Map((shiftsRes.data ?? []).map(s => [s.id, s.staff_id as string]))

  const staffIdByBookingId = new Map<string, string>()
  for (const row of shiftBookingsRes.data ?? []) {
    const staffId = staffIdByShiftId.get(row.shift_id)
    if (staffId) staffIdByBookingId.set(row.booking_id, staffId)
  }
  for (const row of ownShiftsRes.data ?? []) {
    if (row.booking_id && row.staff_id && !staffIdByBookingId.has(row.booking_id)) {
      staffIdByBookingId.set(row.booking_id, row.staff_id)
    }
  }

  const staffIdByAvailabilityPk = new Map<number, string>()
  for (const row of sharedShiftsRes.data ?? []) {
    if (row.fareharbor_availability_pk != null && row.staff_id && !staffIdByAvailabilityPk.has(row.fareharbor_availability_pk)) {
      staffIdByAvailabilityPk.set(row.fareharbor_availability_pk, row.staff_id)
    }
  }

  function resolveStaffId(b: CaptainLookupBooking): string | undefined {
    const direct = staffIdByBookingId.get(b.id)
    if (direct) return direct

    if (b.fareharbor_availability_pk != null) {
      const byPk = staffIdByAvailabilityPk.get(b.fareharbor_availability_pk)
      if (byPk) return byPk

      for (const siblingId of siblingIdsByPk.get(b.fareharbor_availability_pk) ?? []) {
        const siblingStaffId = staffIdByBookingId.get(siblingId)
        if (siblingStaffId) return siblingStaffId
      }
    }

    return undefined
  }

  const allStaffIds = [...new Set(bookings.map(resolveStaffId).filter((id): id is string => !!id))]
  if (allStaffIds.length === 0) return result

  const { data: staffRows } = await supabase.from('staff').select('id, name').in('id', allStaffIds)
  const nameById = new Map((staffRows ?? []).map(s => [s.id, extractFirstName(s.name)]))

  for (const b of bookings) {
    const staffId = resolveStaffId(b)
    const name = staffId ? nameById.get(staffId) : undefined
    if (name) result.set(b.id, name)
  }

  return result
}
