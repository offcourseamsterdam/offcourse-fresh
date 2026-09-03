import { describe, it, expect } from 'vitest'
import { aggregateCityTaxSummary, type CityTaxBookingRow } from './city-tax'

function row(overrides: Partial<CityTaxBookingRow> = {}): CityTaxBookingRow {
  return {
    id: 'row-1',
    bookingUuid: null,
    bookingDate: '2026-06-15',
    guestCount: 4,
    status: 'confirmed',
    isShadow: false,
    ...overrides,
  }
}

describe('aggregateCityTaxSummary', () => {
  it('sums guests from active bookings and applies the free allowance', () => {
    const rows = [row({ id: 'a', guestCount: 100 }), row({ id: 'b', guestCount: 200 })]
    const summary = aggregateCityTaxSummary(rows, 2026)
    expect(summary.countedGuests).toBe(300)
    expect(summary.freeGuests).toBe(250)
    expect(summary.billableGuests).toBe(50)
    expect(summary.cityTaxOwedCents).toBe(50 * 260)
  })

  it('owes nothing while under the free allowance', () => {
    const rows = [row({ id: 'a', guestCount: 249 })]
    const summary = aggregateCityTaxSummary(rows, 2026)
    expect(summary.billableGuests).toBe(0)
    expect(summary.cityTaxOwedCents).toBe(0)
  })

  it('bills exactly the guests over the threshold, not the whole total', () => {
    const rows = [row({ id: 'a', guestCount: 251 })]
    const summary = aggregateCityTaxSummary(rows, 2026)
    expect(summary.billableGuests).toBe(1)
    expect(summary.cityTaxOwedCents).toBe(260)
  })

  it('treats "booked" the same as "confirmed" — the legacy external sync\'s own vocabulary for a real reservation', () => {
    const rows = [row({ id: 'a', status: 'booked', guestCount: 4 })]
    const summary = aggregateCityTaxSummary(rows, 2026)
    expect(summary.countedGuests).toBe(4)
    expect(summary.countedBookings).toBe(1)
  })

  it('excludes cancelled, rebooked, and pending-payment bookings from the count', () => {
    const rows = [
      row({ id: 'a', status: 'cancelled', guestCount: 4 }),
      row({ id: 'b', status: 'rebooked', guestCount: 4 }),
      row({ id: 'c', status: 'pending_payment', guestCount: 4 }),
    ]
    const summary = aggregateCityTaxSummary(rows, 2026)
    expect(summary.countedGuests).toBe(0)
    expect(summary.excludedNotActive).toBe(3)
  })

  it('excludes an active booking with no guest_count on file, without guessing a number for it', () => {
    const rows = [row({ id: 'a', guestCount: null }), row({ id: 'b', guestCount: 4 })]
    const summary = aggregateCityTaxSummary(rows, 2026)
    expect(summary.countedGuests).toBe(4)
    expect(summary.excludedNoGuestCount).toBe(1)
  })

  it('de-duplicates the same booking_uuid, preferring the authoritative (non-shadow) row', () => {
    const rows = [
      row({ id: 'shadow', bookingUuid: 'uuid-1', isShadow: true, guestCount: 8, status: 'booked' }),
      row({ id: 'authoritative', bookingUuid: 'uuid-1', isShadow: false, guestCount: 4, status: 'confirmed' }),
    ]
    const summary = aggregateCityTaxSummary(rows, 2026)
    expect(summary.countedGuests).toBe(4) // the authoritative row's count, not the shadow's
    expect(summary.countedBookings).toBe(1)
    expect(summary.duplicatesResolved).toBe(1)
  })

  it('keeps a solo shadow row when no authoritative row exists for that booking_uuid', () => {
    const rows = [row({ id: 'shadow-only', bookingUuid: 'uuid-2', isShadow: true, guestCount: 6, status: 'booked' })]
    const summary = aggregateCityTaxSummary(rows, 2026)
    expect(summary.countedGuests).toBe(6)
    expect(summary.duplicatesResolved).toBe(0)
  })

  it('never de-duplicates rows with no booking_uuid at all — each stands alone', () => {
    const rows = [row({ id: 'a', bookingUuid: null, guestCount: 2 }), row({ id: 'b', bookingUuid: null, guestCount: 3 })]
    const summary = aggregateCityTaxSummary(rows, 2026)
    expect(summary.countedGuests).toBe(5)
    expect(summary.duplicatesResolved).toBe(0)
  })

  it('only counts bookings within the requested year', () => {
    const rows = [row({ id: 'a', bookingDate: '2025-12-31', guestCount: 100 }), row({ id: 'b', bookingDate: '2026-01-01', guestCount: 4 })]
    const summary = aggregateCityTaxSummary(rows, 2026)
    expect(summary.countedGuests).toBe(4)
  })

  it('ignores a booking with no date at all', () => {
    const rows = [row({ id: 'a', bookingDate: null, guestCount: 100 })]
    const summary = aggregateCityTaxSummary(rows, 2026)
    expect(summary.countedGuests).toBe(0)
  })
})
