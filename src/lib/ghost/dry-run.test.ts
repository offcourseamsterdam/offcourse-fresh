import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveBookingSlot, toVerdict, abstainVerdict, parseOption } from './dry-run'
import type { SearchResult } from '@/types'

function slot(over: Partial<SearchResult['availableSlots'][0]> = {}) {
  return {
    pk: 9001,
    startTime: '5pm',
    startAt: '2026-06-20T17:00:00Z',
    endAt: '2026-06-20T19:00:00Z',
    headline: '5pm',
    capacity: 1,
    customerTypes: [
      { pk: 7001, totalCapacity: 1, customerTypePk: 1, name: 'Diana 2h', boatId: 'diana' as const, minimumParty: 1, maximumParty: 8, priceCents: 31000, durationMinutes: 120 },
    ],
    ...over,
  }
}

function results(slots: ReturnType<typeof slot>[]): SearchResult[] {
  return [
    {
      listing: { slug: 'private-hidden-gems-cruise', title: 'Private Cruise', category: 'private' } as SearchResult['listing'],
      availableSlots: slots,
      date: '2026-06-20',
      guests: 4,
    },
  ]
}

describe('resolveBookingSlot', () => {
  it('resolves an exact time + fitting option to availPk + customerTypeRatePk', () => {
    const r = resolveBookingSlot(results([slot()]), { listing_slug: 'private-hidden-gems-cruise', time: '5pm', guests: 4 })
    expect(r).toEqual({ availPk: 9001, customerTypeRatePk: 7001, boatId: 'diana', optionName: 'Diana 2h' })
  })

  it('abstains when the listing is gone', () => {
    const r = resolveBookingSlot(results([slot()]), { listing_slug: 'nope', time: '5pm', guests: 4 })
    expect(r).toHaveProperty('error')
  })

  it('abstains when the time no longer matches any slot', () => {
    const r = resolveBookingSlot(results([slot()]), { listing_slug: 'private-hidden-gems-cruise', time: '9am', guests: 4 })
    expect(r).toMatchObject({ error: expect.stringContaining('9am') })
  })

  it('abstains (not guesses) when two slots share the proposed time', () => {
    const r = resolveBookingSlot(results([slot(), slot({ pk: 9002 })]), { listing_slug: 'private-hidden-gems-cruise', time: '5pm', guests: 4 })
    expect(r).toMatchObject({ error: expect.stringContaining('Ambiguous') })
  })

  it('uses party-fit as a tiebreaker among multiple options when none is named', () => {
    const mixed = slot({
      customerTypes: [
        { pk: 7001, totalCapacity: 1, customerTypePk: 1, name: 'Small group', boatId: 'curacao', minimumParty: 1, maximumParty: 2, priceCents: 3500, durationMinutes: 120 },
        { pk: 7002, totalCapacity: 1, customerTypePk: 2, name: 'Large group', boatId: 'curacao', minimumParty: 3, maximumParty: 12, priceCents: 3500, durationMinutes: 120 },
      ],
    })
    // guests=8, no option → party-fit narrows to the large-group type.
    const r = resolveBookingSlot(results([mixed]), { listing_slug: 'private-hidden-gems-cruise', time: '5pm', guests: 8 })
    expect(r).toMatchObject({ customerTypeRatePk: 7002 })
  })

  it('returns a single option and lets FareHarbor judge party limits (validate is the authority)', () => {
    const one = slot({ customerTypes: [{ pk: 7001, totalCapacity: 1, customerTypePk: 1, name: 'Adult', boatId: 'curacao', minimumParty: 1, maximumParty: 2, priceCents: 3500, durationMinutes: 120 }] })
    // Oversize for the option, but we don't abstain locally — validate will reject with a real reason.
    const r = resolveBookingSlot(results([one]), { listing_slug: 'private-hidden-gems-cruise', time: '5pm', guests: 8 })
    expect(r).toMatchObject({ customerTypeRatePk: 7001 })
  })

  it('selects a private Diana option for 4 guests even though its party range is 1/1 (you book the boat, not seats)', () => {
    // The real private-boat semantics: min/max party = 1/1. A naive party
    // filter would exclude Diana for 4 guests; the option selects it directly.
    const privateBoats = slot({
      customerTypes: [
        { pk: 1, totalCapacity: 1, customerTypePk: 1, name: 'Diana - 1.5 Hours', boatId: 'diana', minimumParty: 1, maximumParty: 1, priceCents: 31000, durationMinutes: 90 },
        { pk: 2, totalCapacity: 1, customerTypePk: 2, name: 'Diana - 2 Hours', boatId: 'diana', minimumParty: 1, maximumParty: 1, priceCents: 40000, durationMinutes: 120 },
        { pk: 3, totalCapacity: 1, customerTypePk: 3, name: 'Diana - 3 Hours', boatId: 'diana', minimumParty: 1, maximumParty: 1, priceCents: 59000, durationMinutes: 180 },
        { pk: 4, totalCapacity: 1, customerTypePk: 4, name: 'Curaçao - 2 Hours', boatId: 'curacao', minimumParty: 1, maximumParty: 12, priceCents: 40000, durationMinutes: 120 },
      ],
    })
    const r = resolveBookingSlot(results([privateBoats]), { listing_slug: 'private-hidden-gems-cruise', time: '5pm', guests: 4, option: 'Diana - 2 Hours' })
    expect(r).toMatchObject({ customerTypeRatePk: 2, optionName: 'Diana - 2 Hours' })
  })

  it('disambiguates two fitting options via the proposed option name', () => {
    const twoBoats = slot({
      customerTypes: [
        { pk: 7001, totalCapacity: 1, customerTypePk: 1, name: 'Diana 2h', boatId: 'diana', minimumParty: 1, maximumParty: 8, priceCents: 31000, durationMinutes: 120 },
        { pk: 7002, totalCapacity: 1, customerTypePk: 2, name: 'Curaçao 2h', boatId: 'curacao', minimumParty: 1, maximumParty: 12, priceCents: 39000, durationMinutes: 120 },
      ],
    })
    const r = resolveBookingSlot(results([twoBoats]), { listing_slug: 'private-hidden-gems-cruise', time: '5pm', guests: 4, option: 'Curaçao 2h' })
    expect(r).toMatchObject({ customerTypeRatePk: 7002, boatId: 'curacao' })
  })

  it('disambiguates one boat with several durations by parsing the duration', () => {
    // The real failure mode: same boat, 3 durations all fit 4 guests.
    const dianaDurations = slot({
      customerTypes: [
        { pk: 1, totalCapacity: 1, customerTypePk: 1, name: 'Diana 1.5h', boatId: 'diana', minimumParty: 1, maximumParty: 8, priceCents: 31000, durationMinutes: 90 },
        { pk: 2, totalCapacity: 1, customerTypePk: 2, name: 'Diana 2h', boatId: 'diana', minimumParty: 1, maximumParty: 8, priceCents: 40000, durationMinutes: 120 },
        { pk: 3, totalCapacity: 1, customerTypePk: 3, name: 'Diana 3h', boatId: 'diana', minimumParty: 1, maximumParty: 8, priceCents: 55000, durationMinutes: 180 },
      ],
    })
    // "Diana - 2 Hours" (the format the agent actually produced) → pk 2
    const r = resolveBookingSlot(results([dianaDurations]), { listing_slug: 'private-hidden-gems-cruise', time: '5pm', guests: 4, option: 'Diana - 2 Hours' })
    expect(r).toMatchObject({ customerTypeRatePk: 2, optionName: 'Diana 2h' })
  })

  it('abstains when two options fit and no option name was given', () => {
    const twoBoats = slot({
      customerTypes: [
        { pk: 7001, totalCapacity: 1, customerTypePk: 1, name: 'Diana 2h', boatId: 'diana', minimumParty: 1, maximumParty: 8, priceCents: 31000, durationMinutes: 120 },
        { pk: 7002, totalCapacity: 1, customerTypePk: 2, name: 'Curaçao 2h', boatId: 'curacao', minimumParty: 1, maximumParty: 12, priceCents: 39000, durationMinutes: 120 },
      ],
    })
    const r = resolveBookingSlot(results([twoBoats]), { listing_slug: 'private-hidden-gems-cruise', time: '5pm', guests: 4 })
    expect(r).toMatchObject({ error: expect.stringContaining('Ambiguous') })
  })
})

describe('parseOption', () => {
  it('parses boat + hours across formats and languages', () => {
    expect(parseOption('Diana - 2 Hours')).toEqual({ boatId: 'diana', durationMinutes: 120 })
    expect(parseOption('Curaçao 2h')).toEqual({ boatId: 'curacao', durationMinutes: 120 })
    expect(parseOption('Diana 2 uur')).toEqual({ boatId: 'diana', durationMinutes: 120 })
    expect(parseOption('Diana 1.5h')).toEqual({ boatId: 'diana', durationMinutes: 90 })
    expect(parseOption('90 min Diana')).toEqual({ boatId: 'diana', durationMinutes: 90 })
  })

  it('returns undefined parts when it cannot tell', () => {
    expect(parseOption('the boat')).toEqual({ boatId: undefined, durationMinutes: undefined })
  })
})

describe('toVerdict (fail-closed)', () => {
  it('is_bookable true ONLY when FareHarbor returns literal true', () => {
    expect(toVerdict({ is_bookable: true, receipt_total: 31000 }, 9001, 'T').is_bookable).toBe(true)
    expect(toVerdict({ is_bookable: false, code: 'sold_out', error: 'No capacity' }, 9001, 'T').is_bookable).toBe(false)
  })

  it('coerces a non-true is_bookable to false (never trusts a truthy value)', () => {
    // @ts-expect-error — simulating a malformed response
    expect(toVerdict({ is_bookable: 'yes' }, 9001, 'T').is_bookable).toBe(false)
  })

  it('converts the receipt quote from cents to euros and records the avail pk', () => {
    const v = toVerdict({ is_bookable: true, receipt_total: 31000 }, 9001, 'T')
    expect(v.receipt_total_eur).toBe(310)
    expect(v.checked_avail_pk).toBe(9001)
  })

  it('surfaces the FareHarbor code + error for the team', () => {
    const v = toVerdict({ is_bookable: false, code: 'min_party', error: 'Minimum 6' }, 9001, 'T')
    expect(v).toMatchObject({ code: 'min_party', error: 'Minimum 6', is_bookable: false })
  })
})

describe('abstainVerdict', () => {
  it('is always not-bookable', () => {
    expect(abstainVerdict('slot gone', 'T')).toMatchObject({ is_bookable: false, code: 'not_validated', error: 'slot gone' })
  })
})

describe('SAFETY: dry-run module never reaches the create path', () => {
  it('does not reference createBooking, rebookBooking, or the book route', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/ghost/dry-run.ts'), 'utf8')
    expect(src).not.toContain('createBooking')
    expect(src).not.toContain('rebookBooking')
    expect(src).not.toContain('booking-flow/book')
    // It DOES use the non-mutating validate.
    expect(src).toContain('validateBooking')
  })
})
