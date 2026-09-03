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

    // Debt Service (Aflossing + Rente):
    expect(aug.loanPrincipalCents).toBe(75000) // € 750
    expect(aug.loanInterestCents).toBe(17500) // € 175
    expect(aug.totalDebtServiceCents).toBe(92500) // € 925
    expect(result.totals.totalDebtServiceCents).toBe(92500 * 12)
    expect(result.totals.monthsUntilDebtFree).toBe(Math.ceil(4000000 / 75000))

    // 3-Tier Cost Hierarchy assertions:
    // Tier 3: commission 3500 + cityTax (10 * 260 = 2600) + catering 5750 + skipper (2h * 35 = 7000) = 18850
    expect(aug.tier3VariableCostsCents).toBe(18850)
    // Gross Contribution Margin = 45000 - 18850 = 26150
    expect(aug.grossContributionMarginCents).toBe(26150)
    expect(aug.grossContributionMarginPct).toBe(Math.round((26150 / 45000) * 100))

    // Tier 1 Fixed Costs = berth (66667) + other (100000) + owner (300000) + loan interest (17500) = 484167
    expect(aug.tier1FixedCostsCents).toBe(Math.round((2 * 400000) / 12) + 100000 + 300000 + 17500)
    expect(aug.operatingCashFlowCents).toBe(26150 - aug.tier1FixedCostsCents)

    expect(aug.isCurrentMonth).toBe(true)
  })

  it('handles multiple distinct loans with individual and aggregated debt freedom metrics', () => {
    const customLoans = [
      {
        id: 'loan-boat-1',
        name: 'Lening Curaçao',
        principalTotalCents: 2500000, // € 25.000
        monthlyPrincipalCents: 50000, // € 500
        monthlyInterestCents: 11000, // € 110
        interestRatePct: 5.0,
      },
      {
        id: 'loan-boat-2',
        name: 'Lening Tweede Boot',
        principalTotalCents: 1500000, // € 15.000
        monthlyPrincipalCents: 30000, // € 300
        monthlyInterestCents: 7000, // € 70
        interestRatePct: 5.5,
      },
    ]

    const settings = {
      ...DEFAULT_BUDGET_SETTINGS,
      loans: customLoans,
    }

    const result = computeMonthlyCockpit({
      year: 2026,
      bookings: [],
      shifts: [],
      settings,
    })

    const month1 = result.months[0]
    // Aggregated monthly principal = 500 + 300 = € 800
    expect(month1.loanPrincipalCents).toBe(80000)
    // Aggregated monthly interest = 110 + 70 = € 180
    expect(month1.loanInterestCents).toBe(18000)
    expect(month1.totalDebtServiceCents).toBe(98000)

    // Totals summary
    expect(result.totals.loansSummary.length).toBe(2)
    expect(result.totals.loansSummary[0].name).toBe('Lening Curaçao')
    expect(result.totals.loansSummary[0].monthsUntilPaidOff).toBe(Math.ceil(2500000 / 50000)) // 50 months
    expect(result.totals.loansSummary[1].name).toBe('Lening Tweede Boot')
    expect(result.totals.loansSummary[1].monthsUntilPaidOff).toBe(Math.ceil(1500000 / 30000)) // 50 months

    expect(result.totals.totalLoanPrincipalCents).toBe(80000 * 12)
    expect(result.totals.totalLoanInterestCents).toBe(18000 * 12)
  })

  it('calculates marketing what-if scenario (€ 4.000 vs € 2.000) and Amsterdam Light Festival breakeven', () => {
    const alfCategories = [
      { id: 'c1', name: 'Cat 1: Curaçao', active: true, feeCents: 190000, ticketPriceCents: 3500 },
      { id: 'c2', name: 'Cat 2: Open Sloep', active: false, feeCents: 190000, ticketPriceCents: 3500 },
    ]

    const settings = {
      ...DEFAULT_BUDGET_SETTINGS,
      marketingScenarioSpendCents: 400000, // € 4.000
      alfCategories,
    }

    const result = computeMonthlyCockpit({
      year: 2026,
      bookings: [
        {
          id: 'b1',
          booking_date: '2026-12-10',
          status: 'confirmed',
          stripe_amount: 35000, // € 350
        },
      ],
      shifts: [],
      settings,
    })

    // Marketing Scenario:
    expect(result.totals.marketingScenario.baselineSpendCents).toBe(200000)
    expect(result.totals.marketingScenario.activeSpendCents).toBe(400000)
    expect(result.totals.marketingScenario.deltaSpendCents).toBe(200000)
    expect(result.totals.marketingScenario.breakevenCruisesNeeded).toBeGreaterThan(0)

    // ALF Scenario:
    expect(result.totals.alfScenario.totalActiveCategories).toBe(1)
    expect(result.totals.alfScenario.totalFeesCents).toBe(190000)
    const cat1 = result.totals.alfScenario.categories.find(c => c.id === 'c1')!
    expect(cat1.active).toBe(true)
    expect(cat1.feeCents).toBe(190000)
    expect(cat1.breakevenTickets).toBe(Math.ceil(190000 / 3500)) // 55 tickets

    // Dec ALF allocation (50% in December = € 950)
    const dec = result.months.find(m => m.month === '2026-12')!
    expect(dec.alfFeesMonthlyCents).toBe(95000)
  })
})
