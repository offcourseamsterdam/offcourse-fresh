import { describe, it, expect } from 'vitest'
import { run12MonthSimulation, type SimulationParams } from './simulation-engine'

describe('Simulation Engine', () => {
  const baseParams: SimulationParams = {
    startingCashCents: 2000000,
    fleetSize: 2,
    occupancyPct: 18.2,
    scenarioPreset: 'realistic',
    fbSpendPerGuestCents: 320,
    directBookingRatioPct: 54.6,
    ownerSalaryMonthlyCents: 800000,
    expansionEnabled: false,
    expansionMonthIndex: 6,
    expansionCapexCents: 6500000,
    expansionFinancingType: 'debt_50',
  }

  it('generates a 12-month projection starting from September 2026', () => {
    const res = run12MonthSimulation(baseParams)
    expect(res.projections).toHaveLength(12)
    expect(res.projections[0].monthLabel).toBe('Sep 2026')
    expect(res.projections[1].monthLabel).toBe('Okt 2026')
    expect(res.projections[11].monthLabel).toBe('Aug 2027')
  })

  it('correctly schedules the October 2026 interest payment (€ 6.366,22)', () => {
    const res = run12MonthSimulation(baseParams)
    const oct = res.projections[1] // monthIndex 1 = Oct 2026
    expect(oct.calendarMonth).toBe(10)
    expect(oct.debtServiceInterestCents).toBe(636622)
  })

  it('correctly schedules the April 2027 payment including Tijs Louman bullet principal', () => {
    const res = run12MonthSimulation(baseParams)
    const apr = res.projections[7] // monthIndex 7 = Apr 2027
    expect(apr.calendarMonth).toBe(4)
    expect(apr.debtServicePrincipalCents).toBe(600000)
    expect(apr.debtServiceInterestCents).toBe(636200)
  })

  it('simulates buying a 3rd boat with 50% cash and 50% debt', () => {
    const paramsWithBoat3: SimulationParams = {
      ...baseParams,
      expansionEnabled: true,
      expansionMonthIndex: 6, // March 2027
      expansionCapexCents: 6500000,
      expansionFinancingType: 'debt_50',
    }
    const res = run12MonthSimulation(paramsWithBoat3)
    const march = res.projections[6]
    expect(march.activeBoats).toBe(3)
    expect(march.capexCents).toBe(3250000) // 50% cash upfront

    const april = res.projections[7]
    expect(april.activeBoats).toBe(3)
    expect(april.capexCents).toBe(0)
  })

  it('responds with a stress warning when cash is drained under heavy stress conditions', () => {
    const stressParams: SimulationParams = {
      ...baseParams,
      scenarioPreset: 'stress',
      occupancyPct: 10,
      startingCashCents: 500000, // low cash
    }
    const res = run12MonthSimulation(stressParams)
    expect(res.minimumCashCents).toBeLessThan(stressParams.startingCashCents)
    expect(res.cfoVerdict.canAffordExpansion).toBe(false)
  })
})
