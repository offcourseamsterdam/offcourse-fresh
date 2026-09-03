import { describe, it, expect } from 'vitest'
import {
  resolveItemCostPrice,
  calculateCateringOrderCosts,
  DEFAULT_CATERING_COST_CENTS,
} from './catering-costs'

describe('catering-costs calculations', () => {
  it('resolves fallback cost price when not in catalog', () => {
    const cost = resolveItemCostPrice('Bites Box Large (6 guests)', null)
    expect(cost).toBe(3250)
  })

  it('prefers catalog cost price when present', () => {
    const catalog = [
      {
        id: '1',
        name: 'Bites Box Large (6 guests)',
        category: 'food',
        price_value: 6500,
        cost_price_value: 2900,
      },
    ]
    const cost = resolveItemCostPrice('Bites Box Large (6 guests)', catalog)
    expect(cost).toBe(2900)
  })

  it('calculates order costs, revenue, margin and percentage', () => {
    const extras = [
      { name: 'Bites Box Large (6 guests)', amount_cents: 6500, quantity: 1, category: 'food' },
      { name: 'Unlimited Drinks', amount_cents: 2000, quantity: 2, category: 'drinks' },
      { name: 'Some other non-catering extra', amount_cents: 5000, quantity: 1, category: 'protection' },
    ]
    const result = calculateCateringOrderCosts(extras)

    // Bites Box: 6500 sell, 3250 cost
    // Unlimited Drinks (qty 2): 2000 sell, 2 * 350 = 700 cost
    // Protection: ignored
    expect(result.sellingCents).toBe(8500)
    expect(result.costCents).toBe(3250 + 700)
    expect(result.marginCents).toBe(8500 - 3950)
    expect(result.marginPct).toBe(Math.round(((8500 - 3950) / 8500) * 100))
    expect(result.itemCount).toBe(3)
  })

  it('handles null and empty arrays gracefully', () => {
    expect(calculateCateringOrderCosts(null)).toEqual({
      sellingCents: 0,
      costCents: 0,
      marginCents: 0,
      marginPct: 0,
      itemCount: 0,
    })
    expect(calculateCateringOrderCosts([])).toEqual({
      sellingCents: 0,
      costCents: 0,
      marginCents: 0,
      marginPct: 0,
      itemCount: 0,
    })
  })
})
