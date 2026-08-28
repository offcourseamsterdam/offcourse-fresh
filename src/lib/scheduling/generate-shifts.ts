/**
 * Pure shift-generation logic: bookings in → shift mutations out.
 * No I/O here — sync-shifts.ts feeds it rows and applies the result.
 *
 * WHAT A SHIFT IS
 * A shift is a captain's continuous block of WORK on one boat, not a cruise.
 * It is the cruise(s) plus the real work wrapped around them:
 *
 *   [45m prep] [cruise] ←30m turnaround→ [cruise] [60m wrap-up]
 *   └──────────────── one shift, one captain ─────────────────┘
 *
 * So three back-to-back cruises on Diana are ONE shift covering the whole
 * afternoon, not three disconnected ones. That is why a shift can cover many
 * departures (see 127_shift_bookings.sql) — membership, not a single pointer.
 *
 * IDENTITY (how a block finds "its" existing shift on re-sync)
 * By shared booking membership: the existing shift covering the most of this
 * block's departures is the same shift. This survives the things that break a
 * fixed key — a booking added to the day, one cancelled, times shifted — and
 * keeps the captain, status and notes already on that row.
 *
 * Shifts covering no bookings at all are MANUAL — the sync never touches them.
 *
 * BOAT
 *  - private: parsed from customer_type_name ("Diana - 1.5 Hours")
 *  - shared: defaults to Curaçao (decision Beer 2026-06-12); the admin can
 *    change it per shift afterwards and the sync never overwrites that.
 */

import { parseDurationMinutes } from '../../../supabase/functions/_shared/duration'

/** Prep before the block's FIRST departure: crew call, boat ready, greet. */
export const PREP_MINUTES_BEFORE_FIRST = 45
/**
 * Turnaround between two cruises inside one block: guests off, clean, reset,
 * next guests on. The captain is working through it, so it is covered by the
 * block rather than added to it — it is real time on the clock either way.
 * Grounded in the live data: real same-boat back-to-back gaps are exactly 30m.
 */
export const TURNAROUND_MINUTES = 30
/** Wrap-up after the block's LAST departure: unload, clean down, close up. */
export const WRAP_MINUTES_AFTER_LAST = 60

/**
 * ONE BOAT, ONE DAY, ONE SHIFT (Beer's rule, 2026-08-17).
 *
 * Every departure a boat makes on a day belongs to the same shift, however
 * far apart they sit — a boat has one captain for the day, so a morning and
 * an evening cruise on Diana are one person's working day, not two shifts to
 * fill separately. There is deliberately no gap threshold here.
 *
 * Consequence worth knowing: a day with a long midday gap produces a long
 * shift, and shiftCostCents() prices a shift purely on its duration — so the
 * cost line for such a day counts the idle middle as paid time.
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
  date: string
  start_at: string
  end_at: string
  boat_id: string
  status: string
  /** Departures this shift covers (shift_bookings). Empty = manual shift. */
  booking_ids: string[]
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
  /** The block's first departure — a hint for read paths, never an identity. */
  booking_id: string | null
  fareharbor_availability_pk: number | null
  status: 'open'
  /** Full membership, written to shift_bookings by the caller. */
  booking_ids: string[]
}

export interface ShiftToUpdate {
  id: string
  changes: Partial<Pick<SyncShift, 'date' | 'start_at' | 'end_at' | 'boat_id' | 'status'>>
  /** Desired membership; caller diffs it against what is stored. */
  booking_ids: string[]
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

const MINUTE_MS = 60_000

/** "Curaçao" → "curacao": lowercase + strip diacritics, for name matching. */
function normalizeName(name: string): string {
  // NFD splits "ç" into "c" + combining cedilla; U+0300–U+036F is the
  // combining-marks block, so stripping it leaves plain ASCII letters.
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

// Re-exported so this module stays the one place the scheduler imports from,
// while the parsing itself lives with the FareHarbor duration rules it belongs
// to — and stays identical to the copy the Deno webhook runs.
export { parseDurationMinutes }

function isoOrNull(value: string | null): string | null {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

function shiftIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * MINUTE_MS).toISOString()
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
    end = shiftIso(start, minutes)
  }
  return { start, end }
}

/**
 * One real sailing: a private booking, or a shared departure with everyone
 * who booked onto it. The unit blocks are built from.
 */
interface Departure {
  bookingIds: string[]
  start: string
  end: string
  date: string
  boatId: string
  fhPk: number | null
  /** Private cruises name their boat; shared ones only default to one. */
  boatAuthoritative: boolean
}

/** A captain's continuous block of work on one boat — becomes one shift. */
interface Block {
  departures: Departure[]
  date: string
  boatId: string
  /** Padded — what actually goes on the shift row. */
  start_at: string
  end_at: string
  boatAuthoritative: boolean
}

function buildDepartures(
  bookings: SyncBooking[],
  boatByName: Map<string, string>,
  skipped: SkippedBooking[],
): Departure[] {
  const departures: Departure[] = []

  // ── Private bookings: one departure each ────────────────────────────
  for (const b of bookings.filter(x => x.category !== 'shared')) {
    if (!ACTIVE_STATUSES.has(b.status ?? '')) continue
    const window = resolveWindow(b)
    if (!window) {
      skipped.push({ bookingId: b.id, reason: 'no start time' })
      continue
    }
    const boatId = boatByName.get(normalizeName((b.customer_type_name ?? '').split(' - ')[0]))
    if (!boatId) {
      skipped.push({ bookingId: b.id, reason: `cannot resolve boat from "${b.customer_type_name}"` })
      continue
    }
    departures.push({
      bookingIds: [b.id],
      start: window.start,
      end: window.end,
      date: b.booking_date ?? window.start.slice(0, 10),
      boatId,
      fhPk: null,
      boatAuthoritative: true,
    })
  }

  // ── Shared bookings: one departure per FareHarbor sailing ───────────
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
    if (actives.length === 0) continue

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
    departures.push({
      bookingIds: windows.map(x => x.b.id),
      start,
      end,
      date: windows[0].b.booking_date ?? start.slice(0, 10),
      boatId: curacaoId,
      fhPk: members[0].fareharbor_availability_pk,
      boatAuthoritative: false,
    })
  }

  return departures
}

/**
 * Departures → padded work blocks: one block per boat per day, covering every
 * departure that boat makes (see the ONE BOAT, ONE DAY, ONE SHIFT note above).
 */
export function buildBlocks(departures: Departure[]): Block[] {
  const byBoatDay = new Map<string, Departure[]>()
  for (const d of departures) {
    const key = `${d.date}::${d.boatId}`
    const list = byBoatDay.get(key)
    if (list) list.push(d)
    else byBoatDay.set(key, [d])
  }

  const blocks: Block[] = []
  for (const list of byBoatDay.values()) {
    list.sort((a, b) => a.start.localeCompare(b.start))
    // Departures can overlap (a shared sailing and a private one), so `end` is
    // not monotonic — the block runs to the latest end, not the last one.
    const rawStart = list[0].start
    const rawEnd = list.map(d => d.end).sort().at(-1)!
    blocks.push({
      departures: list,
      date: list[0].date,
      boatId: list[0].boatId,
      start_at: shiftIso(rawStart, -PREP_MINUTES_BEFORE_FIRST),
      end_at: shiftIso(rawEnd, WRAP_MINUTES_AFTER_LAST),
      // Authoritative only when every departure names its boat; one shared
      // departure in the mix means the admin may have re-boated it.
      boatAuthoritative: list.every(d => d.boatAuthoritative),
    })
  }

  blocks.sort((a, b) => a.start_at.localeCompare(b.start_at))
  return blocks
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
  const blocks = buildBlocks(buildDepartures(bookings, boatByName, skipped))

  // Only shifts the sync owns are candidates; manual shifts (no membership)
  // are never matched, moved or cancelled here.
  const syncOwned = existingShifts.filter(s => s.booking_ids.length > 0)
  const claimed = new Set<string>()

  for (const block of blocks) {
    const wanted = new Set(block.departures.flatMap(d => d.bookingIds))

    // The existing shift sharing the most departures with this block IS this
    // block — it already carries the captain, status and notes.
    let best: SyncShift | null = null
    let bestOverlap = 0
    for (const s of syncOwned) {
      if (claimed.has(s.id)) continue
      const overlap = s.booking_ids.reduce((n, id) => n + (wanted.has(id) ? 1 : 0), 0)
      if (overlap > bestOverlap) {
        best = s
        bestOverlap = overlap
      }
    }

    const first = block.departures[0]
    const bookingIds = [...wanted]

    if (!best) {
      toCreate.push({
        date: block.date,
        start_at: block.start_at,
        end_at: block.end_at,
        boat_id: block.boatId,
        booking_id: first.bookingIds[0] ?? null,
        fareharbor_availability_pk: first.fhPk,
        status: 'open',
        booking_ids: bookingIds,
      })
      continue
    }

    claimed.add(best.id)

    // Completed shifts are history — times are never rewritten, but membership
    // is still reconciled so reporting knows what the block actually covered.
    if (best.status === 'completed') {
      toUpdate.push({ id: best.id, changes: {}, booking_ids: bookingIds })
      continue
    }

    const changes: ShiftToUpdate['changes'] = {}
    if (best.date !== block.date) changes.date = block.date
    if (isoOrNull(best.start_at) !== block.start_at) changes.start_at = block.start_at
    if (isoOrNull(best.end_at) !== block.end_at) changes.end_at = block.end_at
    if (block.boatAuthoritative && best.boat_id !== block.boatId) changes.boat_id = block.boatId
    // A cancelled shift whose departures came back is live again.
    if (best.status === 'cancelled') changes.status = 'open'

    toUpdate.push({ id: best.id, changes, booking_ids: bookingIds })
  }

  // Sync-owned shifts no block claimed: every departure they covered is gone.
  for (const s of syncOwned) {
    if (claimed.has(s.id)) continue
    if (s.status === 'completed' || s.status === 'cancelled') continue
    toUpdate.push({ id: s.id, changes: { status: 'cancelled' }, booking_ids: [] })
  }

  toCreate.sort((a, b) => a.start_at.localeCompare(b.start_at))
  return { toCreate, toUpdate, skipped }
}
