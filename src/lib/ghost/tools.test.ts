import { describe, it, expect } from 'vitest'
import { extraPriceLabel, compactExtras, compactAvailability, nearbyDates, sharedListingsAlreadyBooked } from './tools'

// Pure helpers only — the tool `run()` functions hit Supabase and are covered
// by the live/integration path, not unit tests.

describe('extraPriceLabel', () => {
  it('formats each price type with correct euro decimals', () => {
    expect(extraPriceLabel('fixed_cents', 2000)).toBe('€20.00')
    expect(extraPriceLabel('per_person_cents', 500)).toBe('€5.00 per person')
    expect(extraPriceLabel('per_person_cents', 1080)).toBe('€10.80 per person') // not rounded to €11
    expect(extraPriceLabel('per_person_per_hour_cents', 1000)).toBe('€10.00 per person per hour')
    expect(extraPriceLabel('percentage', 15)).toBe('15%')
  })

  it('returns no price for informational items', () => {
    expect(extraPriceLabel('informational', 0)).toBe('')
  })
})

describe('compactExtras', () => {
  it('builds a priced menu and omits price for informational items', () => {
    const out = compactExtras([
      { name: 'Bites Box Small', category: 'food', price_type: 'fixed_cents', price_value: 2000, description: 'Olives, cheese, charcuterie for 1-2 guests' },
      { name: 'Unlimited Drinks', category: 'drinks', price_type: 'per_person_per_hour_cents', price_value: 1000 },
      { name: 'Pay per drink bar', category: 'drinks', price_type: 'informational', price_value: 0 },
      { name: 'Charcuterie Platter', category: 'food', price_type: 'per_person_cents', price_value: 1080, min_people: 2 },
    ]) as { menu: Array<Record<string, unknown>>; note: string }

    expect(out.menu).toEqual([
      { name: 'Bites Box Small', category: 'food', price: '€20.00', about: 'Olives, cheese, charcuterie for 1-2 guests' },
      { name: 'Unlimited Drinks', category: 'drinks', price: '€10.00 per person per hour' },
      { name: 'Pay per drink bar', category: 'drinks' }, // informational → no price key
      { name: 'Charcuterie Platter', category: 'food', price: '€10.80 per person', for_at_least: 2 },
    ])
    expect(out.note).toMatch(/booking page/i)
  })

  it('returns an explicit empty menu when there are no extras', () => {
    const out = compactExtras([]) as { menu: unknown[]; note: string }
    expect(out.menu).toEqual([])
    expect(out.note).toMatch(/No food or drinks/i)
  })

  it('truncates long descriptions to keep the agent prompt compact', () => {
    const long = 'x'.repeat(200)
    const out = compactExtras([{ name: 'Big', category: 'food', price_type: 'fixed_cents', price_value: 1000, description: long }]) as {
      menu: Array<{ about?: string }>
    }
    expect(out.menu[0].about?.length).toBe(120)
  })
})

// Guard the existing compaction helper still behaves (it shares this file).
describe('compactAvailability', () => {
  it('reports nothing available when no slots', () => {
    expect(compactAvailability([{ listing: { slug: 's', title: 'T', category: 'private' }, availableSlots: [] }])).toMatchObject({
      available: false,
    })
  })
})

describe('nearbyDates', () => {
  it('returns the 3 days AFTER centerDate — never centerDate itself, never before it', () => {
    expect(nearbyDates('2026-08-21', '2026-08-01')).toEqual(['2026-08-22', '2026-08-23', '2026-08-24'])
  })

  it('drops dates before today rather than suggesting a day that already passed', () => {
    expect(nearbyDates('2026-08-21', '2026-08-23')).toEqual(['2026-08-23', '2026-08-24'])
  })

  it('crosses a month boundary correctly', () => {
    expect(nearbyDates('2026-08-30', '2026-08-01')).toEqual(['2026-08-31', '2026-09-01', '2026-09-02'])
  })
})

describe('sharedListingsAlreadyBooked', () => {
  const SHARED = {
    listing: { id: 'listing-1', title: 'Hidden Gems', slug: 'hidden-gems', category: 'shared', price_display: '€35' },
    availableSlots: [{ startTime: '17:00', startAt: '2026-08-24T17:00:00.000Z' }, { startTime: '19:00', startAt: '2026-08-24T19:00:00.000Z' }],
  }
  const PRIVATE = {
    listing: { id: 'listing-2', title: 'Private Diana', slug: 'private-diana', category: 'private' },
    availableSlots: [{ startTime: '18:00', startAt: '2026-08-24T18:00:00.000Z' }],
  }

  it('keeps only a shared slot that ALREADY has a confirmed booking on that exact listing + departure', () => {
    const existing = [{ listing_id: 'listing-1', start_time: '2026-08-24T17:00:00+00:00' }] // same instant, different string format
    expect(sharedListingsAlreadyBooked([SHARED, PRIVATE], existing)).toEqual([
      { listing: 'Hidden Gems', slug: 'hidden-gems', price: '€35', times: ['17:00'] },
    ])
  })

  it('excludes a technically-available shared slot that has no existing booking yet', () => {
    expect(sharedListingsAlreadyBooked([SHARED], [])).toEqual([])
  })

  it('never returns a private-category listing even if it has an existing booking', () => {
    const existing = [{ listing_id: 'listing-2', start_time: '2026-08-24T18:00:00.000Z' }]
    expect(sharedListingsAlreadyBooked([PRIVATE], existing)).toEqual([])
  })

  it('ignores an existing booking on a DIFFERENT listing or time — never a false match', () => {
    const wrongListing = [{ listing_id: 'listing-99', start_time: '2026-08-24T17:00:00.000Z' }]
    const wrongTime = [{ listing_id: 'listing-1', start_time: '2026-08-24T20:00:00.000Z' }]
    expect(sharedListingsAlreadyBooked([SHARED], wrongListing)).toEqual([])
    expect(sharedListingsAlreadyBooked([SHARED], wrongTime)).toEqual([])
  })

  it('caps times at 6 so the agent prompt stays compact', () => {
    const manySlots = {
      listing: { id: 'listing-3', title: 'Busy', slug: 'busy', category: 'shared' },
      availableSlots: Array.from({ length: 10 }, (_, i) => ({ startTime: `${10 + i}:00`, startAt: `2026-08-24T${10 + i}:00:00.000Z` })),
    }
    const existing = manySlots.availableSlots.map(s => ({ listing_id: 'listing-3', start_time: s.startAt }))
    expect(sharedListingsAlreadyBooked([manySlots], existing)[0].times).toHaveLength(6)
  })

  it('returns an empty array, not a crash, when there are no bookings at all', () => {
    expect(sharedListingsAlreadyBooked([SHARED, PRIVATE], [])).toEqual([])
  })
})
