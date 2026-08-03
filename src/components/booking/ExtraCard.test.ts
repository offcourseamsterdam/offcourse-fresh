import { describe, it, expect } from 'vitest'
import { formatPriceLabel, type ApiExtra } from './ExtraCard'

function makeExtra(overrides: Partial<ApiExtra>): ApiExtra {
  return {
    id: 'x',
    name: 'Test',
    category: 'drinks',
    price_type: 'fixed_cents',
    price_value: 0,
    vat_rate: 21,
    is_required: false,
    ...overrides,
  } as ApiExtra
}

// The advertised price on the card must match what calculateExtras actually charges,
// so adults_only extras (alcohol) show the adult-only headcount.
describe('formatPriceLabel — adults_only', () => {
  it('per_person_per_hour adults_only advertises the adult-only price (Unlimited Drinks)', () => {
    const drinks = makeExtra({
      price_type: 'per_person_per_hour_cents',
      price_value: 1000, // €10/person/hour
      adults_only: true,
    })
    // 2 guests (1 adult + 1 child), 1.5h → 1 × €10 × 1.5 = €15.00
    expect(formatPriceLabel(drinks, 2, 5500, 90, 1)).toBe('€15.00')
  })

  it('per_person_per_hour without adults_only still advertises all guests', () => {
    const bar = makeExtra({
      price_type: 'per_person_per_hour_cents',
      price_value: 1000,
    })
    // adultCount passed but flag off → uses guestCount (2): 2 × €10 × 1.5 = €30.00
    expect(formatPriceLabel(bar, 2, 5500, 90, 1)).toBe('€30.00')
  })

  it('legacy per_person adults_only advertises adult-only price', () => {
    const bubbles = makeExtra({
      price_type: 'per_person_cents',
      price_value: 800,
      adults_only: true,
    })
    // 3 guests, 2 adults → 2 × €8 = €16.00
    expect(formatPriceLabel(bubbles, 3, 5500, 90, 2)).toBe('€16.00')
  })

  it('adultCount omitted → falls back to guestCount (backwards compatible)', () => {
    const drinks = makeExtra({
      price_type: 'per_person_per_hour_cents',
      price_value: 1000,
      adults_only: true,
    })
    // No adultCount → 2 × €10 × 1.5 = €30.00
    expect(formatPriceLabel(drinks, 2, 5500, 90)).toBe('€30.00')
  })

  it('fixed_cents is unaffected by headcount', () => {
    const fixed = makeExtra({ price_type: 'fixed_cents', price_value: 2500, adults_only: true })
    expect(formatPriceLabel(fixed, 4, 5500, 90, 1)).toBe('€25.00')
  })
})
