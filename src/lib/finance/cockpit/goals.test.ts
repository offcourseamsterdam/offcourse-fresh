import { describe, it, expect } from 'vitest'
import { goalProgress } from './goals'
import type { GoalRow } from './types'

const TODAY = '2026-09-04'
const goal = (o: Partial<GoalRow>): GoalRow => ({
  id: 'g1',
  name: "Nieuwe accu's",
  targetCents: 1000000,
  fundedCents: 640000,
  deadline: '2027-06-01',
  priority: 1,
  monthlyFundingCents: 0,
  status: 'active',
  createdAt: '2026-01-01',
  ...o,
})

describe('goalProgress', () => {
  it('progress, remaining, months left', () => {
    const p = goalProgress(goal({}), TODAY)
    expect(p.progressPct).toBe(64)
    expect(p.remainingCents).toBe(360000)
    expect(p.monthsLeft).toBe(9)
  })

  it('behind schedule with a monthly funding plan: 8 full months × €1.000 = €8.000 planned, €6.400 funded → €1.600 behind', () => {
    const p = goalProgress(goal({ monthlyFundingCents: 100000 }), TODAY)
    expect(p.plannedByNowCents).toBe(800000)
    expect(p.behindCents).toBe(160000)
    expect(p.onTrack).toBe(false)
  })

  it('behind schedule with only a deadline: linear from creation to deadline', () => {
    // 2026-01-01 → 2027-06-01 = 516 days; elapsed 246 → 47.7% of €10.000 = €4.767 planned
    const p = goalProgress(goal({ fundedCents: 400000 }), TODAY)
    expect(p.plannedByNowCents).toBe(476744)
    expect(p.behindCents).toBe(76744)
  })

  it('on track when funded ≥ planned', () => {
    expect(goalProgress(goal({ fundedCents: 900000 }), TODAY).onTrack).toBe(true)
  })

  it('no plan (no monthly amount, no deadline) is never behind', () => {
    const p = goalProgress(goal({ deadline: null, fundedCents: 0 }), TODAY)
    expect(p.behindCents).toBe(0)
    expect(p.monthsLeft).toBeNull()
  })

  it('funded never exceeds target in the output; overage is not a negative remaining', () => {
    const p = goalProgress(goal({ fundedCents: 1200000 }), TODAY)
    expect(p.fundedCents).toBe(1000000)
    expect(p.remainingCents).toBe(0)
    expect(p.progressPct).toBe(100)
  })

  it('paused goals are not judged against a plan', () => {
    expect(goalProgress(goal({ status: 'paused', monthlyFundingCents: 100000, fundedCents: 0 }), TODAY).behindCents).toBe(0)
  })
})
