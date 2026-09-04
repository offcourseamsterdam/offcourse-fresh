import { describe, it, expect } from 'vitest'
import { accrueCityTax, cityTaxObligations, quarterBounds, quarterOf, type CityTaxBooking } from './city-tax'

const TODAY = '2026-09-04'
const OPTS = { year: 2026, today: TODAY, centsPerGuest: 260, freeGuestsPerYear: 250 }

const booking = (o: Partial<CityTaxBooking>): CityTaxBooking => ({
  id: 'b1', bookingUuid: null, bookingDate: '2026-08-10', guestCount: 10,
  status: 'confirmed', bookingSource: 'website', ...o,
})

describe('quarter helpers', () => {
  it('maps a date to its quarter', () => {
    expect(quarterOf('2026-01-01')).toBe(1)
    expect(quarterOf('2026-03-31')).toBe(1)
    expect(quarterOf('2026-04-01')).toBe(2)
    expect(quarterOf('2026-12-31')).toBe(4)
  })
  it('knows where each quarter starts and ends', () => {
    expect(quarterBounds(2026, 1)).toEqual({ start: '2026-01-01', end: '2026-03-31' })
    expect(quarterBounds(2026, 4)).toEqual({ start: '2026-10-01', end: '2026-12-31' })
  })
})

describe('accrueCityTax — the yearly exemption is consumed as the year runs', () => {
  it('charges nothing while the allowance lasts', () => {
    const r = accrueCityTax([booking({ bookingDate: '2026-02-01', guestCount: 100 })], OPTS)
    expect(r.quarters[0]).toMatchObject({ guests: 100, exemptGuests: 100, taxableGuests: 0, amountCents: 0 })
    expect(r.totalOwedCents).toBe(0)
  })

  it('splits the quarter in which the allowance runs out', () => {
    const r = accrueCityTax([
      booking({ id: 'a', bookingDate: '2026-02-01', guestCount: 200 }),
      booking({ id: 'b', bookingDate: '2026-05-01', guestCount: 100 }),
    ], OPTS)
    expect(r.quarters[0]).toMatchObject({ exemptGuests: 200, taxableGuests: 0 })
    // 50 of the 100 in Q2 are still free, the other 50 are charged.
    expect(r.quarters[1]).toMatchObject({ guests: 100, exemptGuests: 50, taxableGuests: 50, amountCents: 13_000 })
    expect(r.totalOwedCents).toBe(13_000)
  })

  it('charges everything once the allowance is gone', () => {
    const r = accrueCityTax([
      booking({ id: 'a', bookingDate: '2026-01-15', guestCount: 250 }),
      booking({ id: 'b', bookingDate: '2026-08-15', guestCount: 40 }),
    ], OPTS)
    expect(r.quarters[2]).toMatchObject({ taxableGuests: 40, amountCents: 10_400 })
  })
})

describe('accrueCityTax — due dates and open quarters', () => {
  it('falls due a month after the quarter ends', () => {
    const r = accrueCityTax([booking({ bookingDate: '2026-05-01', guestCount: 300 })], OPTS)
    expect(r.quarters[1]).toMatchObject({ dueDate: '2026-07-31', isClosed: true })
    expect(r.quarters[3].dueDate).toBe('2027-01-31')
  })

  it('marks the quarter we are in as still running', () => {
    const r = accrueCityTax([booking({ bookingDate: '2026-08-15', guestCount: 300 })], OPTS)
    expect(r.quarters[2].isClosed).toBe(false)
    expect(r.quarters[1].isClosed).toBe(true)
  })

  it('lets the deadline be configured rather than inventing one', () => {
    const r = accrueCityTax([booking({ guestCount: 300 })], { ...OPTS, dueMonthsAfterQuarter: 2 })
    expect(r.quarters[2].dueDate).toBe('2026-11-30')
  })
})

describe('accrueCityTax — honesty about what it cannot see', () => {
  it('excludes cancelled bookings and says how many', () => {
    const r = accrueCityTax([
      booking({ id: 'a', guestCount: 300 }),
      booking({ id: 'b', status: 'cancelled', guestCount: 100 }),
    ], OPTS)
    expect(r.excluded.notActive).toBe(1)
    expect(r.quarters[2].guests).toBe(300)
  })

  it('excludes bookings without a guest count and says how many', () => {
    const r = accrueCityTax([booking({ guestCount: null })], OPTS)
    expect(r.excluded.noGuestCount).toBe(1)
  })

  it('names the channels that never reach our own table', () => {
    const r = accrueCityTax(
      [booking({ bookingSource: 'withlocals' }), booking({ id: 'b', bookingSource: 'barqo' })],
      { ...OPTS, untrackedSources: ['withlocals', 'clickandboat', 'getmyboat', 'barqo'] },
    )
    expect(r.excluded.untrackedSources).toEqual(['barqo', 'withlocals'])
  })

  it('counts one real booking once even when two systems wrote a row for it', () => {
    const r = accrueCityTax([
      booking({ id: 'shadow', bookingUuid: 'uuid-1', guestCount: 300, isShadow: true }),
      booking({ id: 'real', bookingUuid: 'uuid-1', guestCount: 300 }),
    ], OPTS)
    expect(r.quarters[2].guests).toBe(300)
  })

  it('treats "booked" as active, matching the rest of the codebase', () => {
    expect(accrueCityTax([booking({ status: 'booked', guestCount: 300 })], OPTS).excluded.notActive).toBe(0)
  })
})

describe('cityTaxObligations', () => {
  it('only proposes quarters that actually owe something', () => {
    const r = accrueCityTax([booking({ bookingDate: '2026-02-01', guestCount: 100 })], OPTS)
    expect(cityTaxObligations(r)).toEqual([])
  })

  it('says in the title when a quarter is still running', () => {
    const r = accrueCityTax([
      booking({ id: 'a', bookingDate: '2026-05-01', guestCount: 300 }),
      booking({ id: 'b', bookingDate: '2026-08-01', guestCount: 100 }),
    ], OPTS)
    const list = cityTaxObligations(r)
    expect(list[0]).toMatchObject({ key: 'city-tax:2026-Q2', isProvisional: false })
    expect(list[0].title).toContain('2026-Q2')
    expect(list[1]).toMatchObject({ key: 'city-tax:2026-Q3', isProvisional: true })
    expect(list[1].title).toContain('loopt nog')
  })
})
