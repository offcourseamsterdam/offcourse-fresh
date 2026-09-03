import { describe, it, expect } from 'vitest'
import {
  computeMonthlyCockpit,
  buildYearMonthKeys,
  DEFAULT_BUDGET_SETTINGS,
} from './profit-cockpit-calculator'

describe('profit-cockpit-calculator', () => {
  it('generates all 12 month keys for a year', () => {
    const keys = buildYearMonthKeys(2026)
    expect(keys.length).toBe(12)
    expect(keys[0]).toBe('2026-01')
    expect(keys[11]).toBe('2026-12')
  })

  it('aggregates revenue, skipper costs, catering costs, and dynamic pots correctly', () => {
    const bookings = [
      {
        id: 'b1',
        booking_date: '2026-08-15',
        status: 'confirmed',
        stripe_amount: 35000, // € 350
        guest_count: 10,
        commission_amount_cents: 3500, // € 35
        extras_selected: [
          { name: 'Bites Box Large (6 guests)', amount_cents: 6500, quantity: 1, category: 'food' },
        ],
      },
    ]

    const shifts = [
      {
        id: 's1',
        date: '2026-08-15',
        start_at: '2026-08-15T14:00:00Z',
        end_at: '2026-08-15T16:00:00Z', // 2 hours
        staff_id: 'staff-beer',
        booking_id: 'b1',
        status: 'completed',
        staff: {
          hourly_rate_cents: 3500, // € 35/h
        },
      },
    ]

    const result = computeMonthlyCockpit({
      year: 2026,
      bookings,
      shifts,
      settings: DEFAULT_BUDGET_SETTINGS,
      currentDate: new Date('2026-08-20'),
    })

    expect(result.months.length).toBe(12)
    const aug = result.months.find(m => m.month === '2026-08')!
    expect(aug).toBeDefined()
    expect(aug.bookingCount).toBe(1)
    expect(aug.totalRevenueCents).toBe(35000)
    expect(aug.channelCommissionCents).toBe(3500)
    expect(aug.cityTaxCents).toBe(10 * 260) // 2600

    // Catering: 6500 selling, 3250 cost
    expect(aug.cateringSellingCents).toBe(6500)
    expect(aug.cateringCostCents).toBe(3250)
    expect(aug.cateringMarginCents).toBe(3250)
    expect(aug.cateringMarginPct).toBe(50)

    // Skipper: 2 hours * 3500 = 7000
    expect(aug.skipperHours).toBe(2)
    expect(aug.skipperCostCents).toBe(7000)

    // Operating Profit = 35000 - 3500 - 2600 - 3250 - 7000 = 18650
    expect(aug.operatingProfitCents).toBe(18650)
    expect(aug.profitPerHourCents).toBe(Math.round(18650 / 2))

    // Dynamic pots (8% maintenance, 6% marketing)
    expect(aug.maintenancePotCents).toBe(Math.round(35000 * 0.08)) // 2800
    expect(aug.marketingPotCents).toBe(Math.round(35000 * 0.06)) // 2100

    expect(aug.isCurrentMonth).toBe(true)
  })
})
