import { describe, it, expect } from 'vitest'
import { calculateExtras, type Extra, type PriceType } from './calculate'

// ── Test helpers ────────────────────────────────────────────────────────────

function makeExtra(overrides: Partial<Extra> & { price_type: PriceType }): Extra {
  return {
    id: 'test-' + Math.random().toString(36).slice(2, 8),
    name: 'Test Extra',
    category: 'general',
    price_value: 0,
    vat_rate: 21,
    is_required: false,
    ...overrides,
  }
}

// ── Base calculation (no extras) ────────────────────────────────────────────

describe('calculateExtras — no extras', () => {
  it('returns base amount with 9% VAT when no extras selected', () => {
    const result = calculateExtras(16500, 4, [])

    expect(result.base_amount_cents).toBe(16500)
    expect(result.base_vat_rate).toBe(9)
    // VAT = 16500 × 9 / 109 = 1362.39 → rounded to 1362
    expect(result.base_vat_amount_cents).toBe(1362)
    expect(result.extras_amount_cents).toBe(0)
    expect(result.extras_vat_amount_cents).toBe(0)
    expect(result.grand_total_cents).toBe(16500)
    expect(result.line_items).toHaveLength(0)
  })

  it('handles zero base amount', () => {
    const result = calculateExtras(0, 2, [])
    expect(result.grand_total_cents).toBe(0)
    expect(result.base_vat_amount_cents).toBe(0)
  })
})

// ── Per-person extras (city tax) ────────────────────────────────────────────

describe('calculateExtras — per_person_cents', () => {
  it('multiplies price_value by guest count', () => {
    const cityTax = makeExtra({
      name: 'City Tax',
      price_type: 'per_person_cents',
      price_value: 200, // €2 per person
      vat_rate: 0,
      is_required: true,
    })

    const result = calculateExtras(10000, 6, [cityTax])

    // 200 × 6 = 1200 cents
    expect(result.line_items).toHaveLength(1)
    expect(result.line_items[0].amount_cents).toBe(1200)
    expect(result.line_items[0].guest_count).toBe(6)
    expect(result.grand_total_cents).toBe(10000 + 1200)
  })

  it('calculates VAT on per-person extras', () => {
    const extra = makeExtra({
      price_type: 'per_person_cents',
      price_value: 121, // €1.21 per person incl. 21% VAT
      vat_rate: 21,
    })

    const result = calculateExtras(10000, 2, [extra])

    // amount = 121 × 2 = 242
    // VAT = 242 × 21 / 121 = 42
    expect(result.line_items[0].amount_cents).toBe(242)
    expect(result.line_items[0].vat_amount_cents).toBe(42)
  })
})

// ── Fixed extras ────────────────────────────────────────────────────────────

describe('calculateExtras — fixed_cents', () => {
  it('adds fixed price regardless of guest count', () => {
    const drinks = makeExtra({
      name: 'Drinks Package',
      price_type: 'fixed_cents',
      price_value: 2500, // €25
      vat_rate: 21,
    })

    const result = calculateExtras(10000, 1, [drinks])
    expect(result.line_items[0].amount_cents).toBe(2500)
    expect(result.grand_total_cents).toBe(12500)

    // Same total for 10 guests
    const result2 = calculateExtras(10000, 10, [drinks])
    expect(result2.grand_total_cents).toBe(12500)
  })

  it('calculates VAT on fixed extras', () => {
    const extra = makeExtra({
      price_type: 'fixed_cents',
      price_value: 1210, // €12.10 incl. 21% VAT
      vat_rate: 21,
    })

    const result = calculateExtras(10000, 2, [extra])
    // VAT = 1210 × 21 / 121 = 210
    expect(result.line_items[0].vat_amount_cents).toBe(210)
  })
})

// ── Percentage extras (insurance) ───────────────────────────────────────────

describe('calculateExtras — percentage', () => {
  it('calculates percentage on subtotal (base + prior extras)', () => {
    const insurance = makeExtra({
      name: 'Insurance',
      price_type: 'percentage',
      price_value: 10, // 10%
      vat_rate: 21,
    })

    const result = calculateExtras(10000, 2, [insurance])
    // 10% of 10000 = 1000
    expect(result.line_items[0].amount_cents).toBe(1000)
    expect(result.grand_total_cents).toBe(11000)
  })

  it('percentage includes per-person + fixed extras in its base', () => {
    const cityTax = makeExtra({
      name: 'City Tax',
      price_type: 'per_person_cents',
      price_value: 100,
      vat_rate: 0,
    })
    const drinks = makeExtra({
      name: 'Drinks',
      price_type: 'fixed_cents',
      price_value: 2000,
      vat_rate: 21,
    })
    const insurance = makeExtra({
      name: 'Insurance',
      price_type: 'percentage',
      price_value: 10,
      vat_rate: 21,
    })

    const result = calculateExtras(10000, 4, [cityTax, drinks, insurance])

    // Subtotal before insurance: 10000 + (100×4) + 2000 = 12400
    // Insurance: 10% of 12400 = 1240
    expect(result.line_items[2].amount_cents).toBe(1240)
    expect(result.grand_total_cents).toBe(12400 + 1240)
  })
})

// ── Informational extras ────────────────────────────────────────────────────

describe('calculateExtras — informational', () => {
  it('informational extras are excluded from all calculations', () => {
    const info = makeExtra({
      name: 'Blankets provided',
      price_type: 'informational',
      price_value: 0,
      vat_rate: 0,
    })

    const result = calculateExtras(10000, 4, [info])
    expect(result.line_items).toHaveLength(0)
    expect(result.extras_amount_cents).toBe(0)
    expect(result.grand_total_cents).toBe(10000)
  })
})

// ── Calculation order ───────────────────────────────────────────────────────

describe('calculateExtras — ordering', () => {
  it('processes in order: per_person → fixed → percentage', () => {
    const perPerson = makeExtra({
      name: 'Tax',
      price_type: 'per_person_cents',
      price_value: 100,
      vat_rate: 0,
    })
    const fixed = makeExtra({
      name: 'Drinks',
      price_type: 'fixed_cents',
      price_value: 500,
      vat_rate: 0,
    })
    const pct = makeExtra({
      name: 'Insurance',
      price_type: 'percentage',
      price_value: 10,
      vat_rate: 0,
    })

    const result = calculateExtras(10000, 2, [pct, fixed, perPerson])

    // Despite array order being [pct, fixed, perPerson],
    // calculation order is: per_person → fixed → percentage
    expect(result.line_items[0].price_type).toBe('per_person_cents')
    expect(result.line_items[1].price_type).toBe('fixed_cents')
    expect(result.line_items[2].price_type).toBe('percentage')

    // per_person: 100 × 2 = 200, subtotal = 10200
    // fixed: 500, subtotal = 10700
    // percentage: 10% of 10700 = 1070
    expect(result.line_items[2].amount_cents).toBe(1070)
    expect(result.grand_total_cents).toBe(10000 + 200 + 500 + 1070)
  })
})

// ── VAT totals ──────────────────────────────────────────────────────────────

describe('calculateExtras — VAT aggregation', () => {
  it('total_vat = base_vat + extras_vat', () => {
    const extra = makeExtra({
      price_type: 'fixed_cents',
      price_value: 1210,
      vat_rate: 21,
    })

    const result = calculateExtras(10900, 2, [extra])

    // Base VAT: 10900 × 9 / 109 = 900
    expect(result.base_vat_amount_cents).toBe(900)

    // Extra VAT: 1210 × 21 / 121 = 210
    expect(result.extras_vat_amount_cents).toBe(210)

    // Total VAT: 900 + 210 = 1110
    expect(result.total_vat_amount_cents).toBe(1110)
  })

  it('zero VAT rate produces zero VAT', () => {
    const extra = makeExtra({
      price_type: 'fixed_cents',
      price_value: 1000,
      vat_rate: 0,
    })

    const result = calculateExtras(10000, 2, [extra])
    expect(result.line_items[0].vat_amount_cents).toBe(0)
  })
})

// ── Per-person-per-hour pricing ────────────────────────────────────────────

describe('calculateExtras — per_person_per_hour_cents', () => {
  it('calculates correctly for 4 guests × 1.5 hours', () => {
    const unlimited = makeExtra({
      name: 'Unlimited Bar',
      price_type: 'per_person_per_hour_cents',
      price_value: 1000, // €10/person/hour
      vat_rate: 21,
    })

    // 1000 × 4 × 1.5 = 6000 cents (€60)
    const result = calculateExtras(10000, 4, [unlimited], 90)
    expect(result.line_items).toHaveLength(1)
    expect(result.line_items[0].amount_cents).toBe(6000)
    expect(result.grand_total_cents).toBe(16000)
  })

  it('calculates correctly for 2 guests × 2 hours', () => {
    const unlimited = makeExtra({
      name: 'Unlimited Bar',
      price_type: 'per_person_per_hour_cents',
      price_value: 1000,
      vat_rate: 21,
    })

    // 1000 × 2 × 2 = 4000 cents (€40)
    const result = calculateExtras(10000, 2, [unlimited], 120)
    expect(result.line_items[0].amount_cents).toBe(4000)
    expect(result.grand_total_cents).toBe(14000)
  })

  it('calculates correctly for 6 guests × 3 hours', () => {
    const unlimited = makeExtra({
      name: 'Unlimited Bar',
      price_type: 'per_person_per_hour_cents',
      price_value: 1000,
      vat_rate: 21,
    })

    // 1000 × 6 × 3 = 18000 cents (€180)
    const result = calculateExtras(10000, 6, [unlimited], 180)
    expect(result.line_items[0].amount_cents).toBe(18000)
  })

  it('uses default 90 minutes when durationMinutes is omitted', () => {
    const unlimited = makeExtra({
      price_type: 'per_person_per_hour_cents',
      price_value: 1000,
      vat_rate: 21,
    })

    // 1000 × 2 × 1.5 = 3000
    const result = calculateExtras(10000, 2, [unlimited])
    expect(result.line_items[0].amount_cents).toBe(3000)
  })

  it('includes correct VAT at 21%', () => {
    const unlimited = makeExtra({
      price_type: 'per_person_per_hour_cents',
      price_value: 1000,
      vat_rate: 21,
    })

    // 6000 × 21 / 121 = 1041 (rounded)
    const result = calculateExtras(10000, 4, [unlimited], 90)
    expect(result.line_items[0].vat_amount_cents).toBe(Math.round(6000 * 21 / 121))
  })
})
