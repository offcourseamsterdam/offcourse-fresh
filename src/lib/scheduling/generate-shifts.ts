/**
 * Pure shift-generation logic: bookings in → shift mutations out.
 * No I/O here — the sync API route feeds it rows and applies the result.
 *
 * Identity rules (how a booking finds "its" shift):
 *  - private booking → shift keyed by booking_id (DB-unique)
 *  - shared bookings → ONE shift per FareHarbor departure, keyed by
 *    fareharbor_availability_pk (DB-unique). One sailing, one skipper.
 *  - manual shifts (neither key set) are never touched by the sync.
 *
 * Boat rules:
 *  - private: parsed from customer_type_name ("Diana - 1.5 Hours")
 *  - shared: defaults to Curaçao (decision Beer 2026-06-12), admin can
 *    change it per shift in the grid afterwards — the sync never
 *    overwrites the boat on an existing shared shift.
 */

export interface SyncBooking {
  id: string
  booking_date: string | null
  start_time: string | null
  end_time: string | null
  status: string | null
  category: string | null
  customer_type_name: string | null
  fareharbor_availability_pk: number | null
}

export interface SyncShift {
  id: string
  booking_id: string | null
  fareharbor_availability_pk: number | null
  date: string
  start_at: string
  end_at: string
  boat_id: string
  status: string
}

export interface SyncBoat {
  id: string
  name: string
}

export interface ShiftToCreate {
  date: string
  start_at: string
  end_at: string
  boat_id: string
  booking_id: string | null
  fareharbor_availability_pk: number | null
  status: 'open'
}

export interface ShiftToUpdate {
  id: string
  changes: Partial<Pick<SyncShift, 'date' | 'start_at' | 'end_at' | 'boat_id' | 'status'>>
}

export interface SkippedBooking {
  bookingId: string
  reason: string
}

export interface GenerateResult {
  toCreate: ShiftToCreate[]
  toUpdate: ShiftToUpdate[]
  skipped: SkippedBooking[]
}

/** Statuses that mean "this sailing is real and needs a skipper". */
const ACTIVE_STATUSES = new Set(['booked', 'confirmed'])

/** Fallback durations when the booking has no usable end time. */
const DEFAULT_SHARED_MINUTES = 90
const DEFAULT_PRIVATE_MINUTES = 120

const SHARED_DEFAULT_BOAT = 'curacao'

/** "Curaçao" → "curacao": lowercase + strip diacritics, for name matching. */
function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** "Diana - 1.5 Hours" → 90. Returns null if no duration is present. */
export function parseDurationMinutes(customerTypeName: string | null): number | null {
  if (!customerTypeName) return null
  const m = customerTypeName.match(/([\d]+(?:[.,]\d+)?)\s*hour/i)
  if (!m) return null
  const hours = parseFloat(m[1].replace(',', '.'))
  return Number.isFinite(hours) ? Math.round(hours * 60) : null
}

function isoOrNull(value: string | null): string | null {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Booking start/end → a valid [start, end) window, repairing missing/equal ends. */
function resolveWindow(b: SyncBooking): { start: string; end: string } | null {
  const start = isoOrNull(b.start_time)
  if (!start) return null
  let end = isoOrNull(b.end_time)
  if (!end || end <= start) {
    const minutes =
      parseDurationMinutes(b.customer_type_name) ??
      (b.category === 'shared' ? DEFAULT_SHARED_MINUTES : DEFAULT_PRIVATE_MINUTES)
    end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString()
  }
  return { start, end }
}

function resolveDate(b: SyncBooking, startIso: string): string {
  return b.booking_date ?? startIso.slice(0, 10)
}

/** The shift a booking/departure SHOULD have right now. */
interface DesiredShift {
  date: string
  start_at: string
  end_at: string
  boat_id: string
  booking_id: string | null
  fareharbor_availability_pk: number | null
  /** Shared shifts keep whatever boat the admin set; private follow the booking. */
  boatAuthoritative: boolean
}

export function generateShiftsFromBookings(
  bookings: SyncBooking[],
  existingShifts: SyncShift[],
  boats: SyncBoat[],
): GenerateResult {
  const toCreate: ShiftToCreate[] = []
  const toUpdate: ShiftToUpdate[] = []
  const skipped: SkippedBooking[] = []

  const boatByName = new Map(boats.map(b => [normalizeName(b.name), b.id]))

  const byBookingId = new Map<string, SyncShift>()
  const byAvailabilityPk = new Map<number, SyncShift>()
  for (const s of existingShifts) {
    if (s.booking_id) byBookingId.set(s.booking_id, s)
    if (s.fareharbor_availability_pk != null) byAvailabilityPk.set(s.fareharbor_availability_pk, s)
  }

  const desired: DesiredShift[] = []
  // Shifts whose source booking(s) are all gone (cancelled/rebooked) → cancel.
  const deadShiftIds = new Set<string>()

  // ── Private bookings: one shift each ────────────────────────────────
  const privates = bookings.filter(b => b.category !== 'shared')
  for (const b of privates) {
    const active = ACTIVE_STATUSES.has(b.status ?? '')
    const existing = byBookingId.get(b.id)
    if (!active) {
      if (existing) deadShiftIds.add(existing.id)
      continue
    }
    const window = resolveWindow(b)
    if (!window) {
      skipped.push({ bookingId: b.id, reason: 'no start time' })
      continue
    }
    const boatName = normalizeName((b.customer_type_name ?? '').split(' - ')[0])
    const boatId = boatByName.get(boatName)
    if (!boatId) {
      skipped.push({ bookingId: b.id, reason: `cannot resolve boat from "${b.customer_type_name}"` })
      continue
    }
    desired.push({
      date: resolveDate(b, window.start),
      start_at: window.start,
      end_at: window.end,
      boat_id: boatId,
      booking_id: b.id,
      fareharbor_availability_pk: null,
      boatAuthoritative: true,
    })
  }

  // ── Shared bookings: one shift per departure ────────────────────────
  const curacaoId = boatByName.get(SHARED_DEFAULT_BOAT)
  const groups = new Map<string, SyncBooking[]>()
  for (const b of bookings.filter(x => x.category === 'shared')) {
    const key =
      b.fareharbor_availability_pk != null
        ? `pk:${b.fareharbor_availability_pk}`
        : `t:${b.booking_date}:${b.start_time}`
    const list = groups.get(key)
    if (list) list.push(b)
    else groups.set(key, [b])
  }

  for (const members of groups.values()) {
    const actives = members.filter(b => ACTIVE_STATUSES.has(b.status ?? ''))
    const pk = members[0].fareharbor_availability_pk
    const existing =
      (pk != null ? byAvailabilityPk.get(pk) : undefined) ??
      members.map(b => byBookingId.get(b.id)).find(Boolean)

    if (actives.length === 0) {
      if (existing) deadShiftIds.add(existing.id)
      continue
    }

    const windows = actives
      .map(b => ({ b, w: resolveWindow(b) }))
      .filter((x): x is { b: SyncBooking; w: { start: string; end: string } } => x.w !== null)
    if (windows.length === 0) {
      for (const b of actives) skipped.push({ bookingId: b.id, reason: 'no start time' })
      continue
    }
    if (!curacaoId) {
      for (const b of actives) skipped.push({ bookingId: b.id, reason: 'default shared boat (Curaçao) not found' })
      continue
    }

    const start = windows.map(x => x.w.start).sort()[0]
    const end = windows.map(x => x.w.end).sort().at(-1)!
    desired.push({
      date: resolveDate(windows[0].b, start),
      start_at: start,
      end_at: end,
      boat_id: curacaoId,
      // pk is the identity when present; otherwise fall back to the first
      // active booking so the DB-unique key still holds.
      booking_id: pk != null ? null : windows[0].b.id,
      fareharbor_availability_pk: pk,
      boatAuthoritative: false,
    })
  }

  // ── Diff desired against existing ───────────────────────────────────
  for (const d of desired) {
    const existing =
      (d.fareharbor_availability_pk != null
        ? byAvailabilityPk.get(d.fareharbor_availability_pk)
        : undefined) ?? (d.booking_id ? byBookingId.get(d.booking_id) : undefined)

    if (!existing) {
      toCreate.push({
        date: d.date,
        start_at: d.start_at,
        end_at: d.end_at,
        boat_id: d.boat_id,
        booking_id: d.booking_id,
        fareharbor_availability_pk: d.fareharbor_availability_pk,
        status: 'open',
      })
      continue
    }

    // Completed shifts are history — never rewritten by the sync.
    if (existing.status === 'completed') continue

    const changes: ShiftToUpdate['changes'] = {}
    if (existing.date !== d.date) changes.date = d.date
    if (isoOrNull(existing.start_at) !== d.start_at) changes.start_at = d.start_at
    if (isoOrNull(existing.end_at) !== d.end_at) changes.end_at = d.end_at
    if (d.boatAuthoritative && existing.boat_id !== d.boat_id) changes.boat_id = d.boat_id
    // Booking came back (e.g. cancelled → rebooked as active again).
    if (existing.status === 'cancelled') changes.status = 'open'

    if (Object.keys(changes).length > 0) toUpdate.push({ id: existing.id, changes })
  }

  // ── Cancel shifts whose bookings are gone ───────────────────────────
  for (const id of deadShiftIds) {
    const existing = existingShifts.find(s => s.id === id)
    if (!existing || existing.status === 'completed' || existing.status === 'cancelled') continue
    toUpdate.push({ id, changes: { status: 'cancelled' } })
  }

  toCreate.sort((a, b) => a.start_at.localeCompare(b.start_at))
  return { toCreate, toUpdate, skipped }
}
