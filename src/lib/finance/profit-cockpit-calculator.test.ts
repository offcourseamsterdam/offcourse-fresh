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

  it('aggregates revenue, skipper costs, catering, zettle, liggeld, owner salary and profit first pots', () => {
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

    // Zettle sales for August: € 100 onboard sales
    const zettleMonths = [
      {
        month: '2026-08-01',
        total_incl_vat_cents: 10000,
        total_vat_cents: 900,
      },
    ]

    const settings = {
      ...DEFAULT_BUDGET_SETTINGS,
      profitFirstProfitPct: 10.0, // 10% winst
      ownerSalaryMonthlyCents: 300000, // € 3.000 / mnd
      boatCount: 2,
      berthFeePerBoatYearlyCents: 400000, // € 4.000 / boot / jaar
      otherFixedCostsMonthlyCents: 100000, // € 1.000 / mnd
      zettleCogsPct: 25.0, // 25% inkoop
    }

    const result = computeMonthlyCockpit({
      year: 2026,
      bookings,
      shifts,
      zettleMonths,
      settings,
      currentDate: new Date('2026-08-20'),
    })

    const aug = result.months.find(m => m.month === '2026-08')!
    expect(aug).toBeDefined()
    expect(aug.bookingCount).toBe(1)

    // Total revenue = 35000 booking + 10000 Zettle = 45000 (€ 450)
    expect(aug.totalRevenueCents).toBe(45000)
    expect(aug.zettleSellingCents).toBe(10000)
    expect(aug.zettleCostCents).toBe(2500) // 25% of 10000

    // Catering total = 6500 (ticket) + 10000 (zettle) = 16500
    expect(aug.cateringSellingCents).toBe(16500)
    expect(aug.cateringCostCents).toBe(3250 + 2500) // 5750

    // Liggeld = 2 * 400000 / 12 = 66667 (€ 666,67)
    expect(aug.berthFeeMonthlyCents).toBe(Math.round((2 * 400000) / 12))
    expect(aug.otherFixedCostsMonthlyCents).toBe(100000)
    expect(aug.totalFixedCostsCents).toBe(Math.round((2 * 400000) / 12) + 100000)

    // Profit First allocations:
    // Profit Pot (10% of 45000) = 4500
    expect(aug.profitFirstProfitPotCents).toBe(4500)
    // Owner salary = 300000 (€ 3.000)
    expect(aug.ownerSalaryPotCents).toBe(300000)

    expect(aug.isCurrentMonth).toBe(true)
  })
})
