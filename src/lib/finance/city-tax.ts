import { CITY_TAX_CENTS_PER_GUEST, CITY_TAX_FREE_GUESTS_PER_YEAR } from '@/lib/booking/constants'

/**
 * Amsterdam's day-trip city tax (€2.60/guest, first 250 guests/year exempt
 * fleet-wide) is already charged to every customer at checkout — see
 * CITY_TAX_CENTS_PER_GUEST. What was missing is a place that adds it all up
 * for remittance to the gemeente.
 *
 * The obvious source — FareHarbor's own booking data — turns out not to be
 * enough on its own: a private charter is booked in FareHarbor as "1 unit"
 * of a flat-rate item regardless of headcount, so FareHarbor has no reliable
 * per-booking guest count for private cruises from ANY sales channel. Our
 * own `bookings` table does store a real `guest_count` — but it's written by
 * two separate systems (this app's own routes, and a legacy external
 * FareHarbor sync outside this repo) that can each leave a row for the same
 * real booking (see migration 086_dedupe_shadow_bookings.sql), and neither
 * system covers Withlocals/Click & Boat/GetMyBoat/Barqo bookings at all —
 * those are entered straight into FareHarbor's own dashboard and never reach
 * this table. FareHarbor's own bookings-list API (needed to close that gap)
 * is currently broken (see the fix-getBookings task spawned 2026-09-02) —
 * until that's fixed, this only counts what our own `bookings` table has.
 *
 * So this aggregator is deliberately honest rather than falsely complete: it
 * de-duplicates by booking_uuid (preferring the authoritative, non-shadow
 * row), counts only bookings in an active status with a guest count on file,
 * and separately reports what got excluded and why — so the number is never
 * presented with more confidence than the data actually supports.
 */

// Mirrors the 'confirmed'/'booked' convention used everywhere else in this
// codebase (see BOOKING_STATUSES in booking/constants.ts) — 'booked' is the
// legacy external sync's own vocabulary for "this is a real, non-cancelled
// FareHarbor reservation," several other readers already treat it as
// equivalent to 'confirmed'.
const ACTIVE_STATUSES = new Set(['confirmed', 'booked'])

/**
 * Booking sources that are known to never appear in the `bookings` table at
 * all (confirmed against production data 2026-09-02: zero rows, ever, for
 * any of these). Staff enter these bookings straight into FareHarbor's own
 * dashboard, so their guests are invisible to this aggregator until either
 * that workflow changes or FareHarbor's own booking list becomes readable.
 */
export const CITY_TAX_UNTRACKED_SOURCES = ['withlocals', 'clickandboat', 'getmyboat', 'barqo'] as const

export interface CityTaxBookingRow {
  id: string
  bookingUuid: string | null
  bookingDate: string | null // "YYYY-MM-DD"
  guestCount: number | null
  status: string | null
  /** true when this row came from the legacy external FareHarbor sync (raw_payload IS NOT NULL). */
  isShadow: boolean
}

export interface CityTaxSummary {
  year: number
  /** Real guests counted toward the tax (active status, guest count on file, de-duplicated). */
  countedGuests: number
  countedBookings: number
  freeGuests: number
  billableGuests: number
  cityTaxOwedCents: number
  /** Active bookings with no guest_count on file — excluded, not assumed to be 0 or 1. */
  excludedNoGuestCount: number
  /** Rows whose status isn't active (cancelled, rebooked, pending, etc.). */
  excludedNotActive: number
  /** Extra rows for a booking_uuid already counted once, dropped as duplicates. */
  duplicatesResolved: number
}

/**
 * Aggregates a year's worth of `bookings` rows into a city-tax summary.
 * Pure function — no I/O — so the dedup/exemption math can be unit tested
 * without a database.
 */
export function aggregateCityTaxSummary(
  rows: CityTaxBookingRow[],
  year: number,
  freeGuestsPerYear: number = CITY_TAX_FREE_GUESTS_PER_YEAR
): CityTaxSummary {
  const inYear = rows.filter(r => r.bookingDate?.startsWith(String(year)))

  // De-dup by booking_uuid: prefer the authoritative (non-shadow) row when
  // both systems wrote one for the same real booking. Rows without a
  // booking_uuid can't collide with anything, so they pass through as-is.
  const singles: CityTaxBookingRow[] = []
  const byUuid = new Map<string, CityTaxBookingRow[]>()
  for (const r of inYear) {
    if (!r.bookingUuid) {
      singles.push(r)
      continue
    }
    const group = byUuid.get(r.bookingUuid)
    if (group) group.push(r)
    else byUuid.set(r.bookingUuid, [r])
  }

  let duplicatesResolved = 0
  const deduped: CityTaxBookingRow[] = [...singles]
  for (const group of byUuid.values()) {
    duplicatesResolved += group.length - 1
    deduped.push(group.find(r => !r.isShadow) ?? group[0])
  }

  let countedGuests = 0
  let countedBookings = 0
  let excludedNoGuestCount = 0
  let excludedNotActive = 0

  for (const r of deduped) {
    if (!r.status || !ACTIVE_STATUSES.has(r.status)) {
      excludedNotActive++
      continue
    }
    if (r.guestCount == null) {
      excludedNoGuestCount++
      continue
    }
    countedGuests += r.guestCount
    countedBookings++
  }

  const billableGuests = Math.max(0, countedGuests - freeGuestsPerYear)
  const cityTaxOwedCents = billableGuests * CITY_TAX_CENTS_PER_GUEST

  return {
    year,
    countedGuests,
    countedBookings,
    freeGuests: freeGuestsPerYear,
    billableGuests,
    cityTaxOwedCents,
    excludedNoGuestCount,
    excludedNotActive,
    duplicatesResolved,
  }
}
