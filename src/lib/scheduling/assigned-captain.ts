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
 * A booking's own `shifts.booking_id` row is checked first. Shared-cruise
 * bookings (several listings on one FareHarbor availability slot) don't each
 * get their own shift row, so those fall back to any shift on the same
 * `fareharbor_availability_pk` — the same fallback the captain-scheduling
 * feature uses elsewhere for shared cruises.
 *
 * Batches both lookups (shifts, then staff names) across the whole input
 * list rather than querying per booking.
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

  const [ownShiftsRes, sharedShiftsRes] = await Promise.all([
    supabase.from('shifts').select('booking_id, staff_id').in('booking_id', bookingIds).not('staff_id', 'is', null),
    availabilityPks.length > 0
      ? supabase
          .from('shifts')
          .select('fareharbor_availability_pk, staff_id')
          .in('fareharbor_availability_pk', availabilityPks)
          .not('staff_id', 'is', null)
      : Promise.resolve({ data: [] as { fareharbor_availability_pk: number | null; staff_id: string | null }[] }),
  ])

  const staffIdByBookingId = new Map<string, string>()
  for (const row of ownShiftsRes.data ?? []) {
    if (row.booking_id && row.staff_id) staffIdByBookingId.set(row.booking_id, row.staff_id)
  }

  const staffIdByAvailabilityPk = new Map<number, string>()
  for (const row of sharedShiftsRes.data ?? []) {
    if (row.fareharbor_availability_pk != null && row.staff_id && !staffIdByAvailabilityPk.has(row.fareharbor_availability_pk)) {
      staffIdByAvailabilityPk.set(row.fareharbor_availability_pk, row.staff_id)
    }
  }

  function resolveStaffId(b: CaptainLookupBooking): string | undefined {
    return (
      staffIdByBookingId.get(b.id) ??
      (b.fareharbor_availability_pk != null ? staffIdByAvailabilityPk.get(b.fareharbor_availability_pk) : undefined)
    )
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
