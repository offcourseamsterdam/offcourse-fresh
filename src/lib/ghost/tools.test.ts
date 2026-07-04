import { describe, it, expect } from 'vitest'
import { extraPriceLabel, compactExtras, compactAvailability } from './tools'

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
