import { describe, it, expect } from 'vitest'
import { formatAllocationSummary, planMonthlyAllocation, type AllocationSettings } from './allocation'
import { computeCockpit } from './compute'
import { goalProgress } from './goals'
import type { CockpitInputs, CockpitResult, GoalRow } from './types'

const TODAY = '2026-09-04'

function goal(over: Partial<GoalRow> = {}): GoalRow {
  return {
    id: 'g1',
    name: 'Nieuwe motor',
    targetCents: 1_000_000,
    fundedCents: 0,
    deadline: null,
    priority: 1,
    monthlyFundingCents: 100_000,
    status: 'active',
    createdAt: '2026-09-01',
    boatId: null,
    ...over,
  }
}

/** A real cockpit from the real engine — never a hand-faked result, so the pot the plan uses is the one the dashboard shows. */
function cockpitFor(args: {
  cashCents: number
  safetyMarginCents?: number
  operationalCents?: number
  salaryCoverageCents?: number
  goals?: GoalRow[]
  over?: Partial<CockpitInputs>
}): CockpitResult {
  return computeCockpit({
    today: TODAY,
    horizon: '3m',
    cash: { clearedCents: args.cashCents, pendingOutCents: 0, pendingInCents: 0, source: 'manual', asOf: null },
    obligations: [],
    operationalCoverageCents: args.operationalCents ?? 0,
    ownerSalary: { monthlyCents: 0, months: 3, coverageCents: args.salaryCoverageCents ?? 0 },
    goals: (args.goals ?? []).map(g => goalProgress(g, TODAY)),
    safetyMarginCents: args.safetyMarginCents ?? 0,
    ...args.over,
  })
}

function settings(over: Partial<AllocationSettings> = {}): AllocationSettings {
  return { ownerSalaryMonthlyCents: 0, ownerSalaryMonths: 3, ownerSalaryCoverageCents: 0, ...over }
}

describe('planMonthlyAllocation — the pot', () => {
  it('allocates from money ABOVE the safety margin, never from free cash still standing behind it', () => {
    // €10.000 cash, nothing claimed, €8.000 safety margin → only €2.000 is genuinely free.
    const c = cockpitFor({ cashCents: 1_000_000, safetyMarginCents: 800_000 })
    expect(c.freeCents).toBe(1_000_000) // the bar's "Vrij" segment ignores the margin…
    expect(c.availableForGrowthCents).toBe(200_000) // …this is what may actually be spent

    const plan = planMonthlyAllocation(c, [goal({ monthlyFundingCents: 1_000_000 })], settings())
    expect(plan.availableCents).toBe(200_000)
    expect(plan.allocatedCents).toBe(200_000)
    expect(plan.allocatedCents).toBeLessThanOrEqual(c.availableForGrowthCents)
  })

  it('INVARIANT: after applying the plan, financial space is still at or above the safety margin', () => {
    const goals = [goal({ id: 'g1', monthlyFundingCents: 500_000 }), goal({ id: 'g2', name: 'Steiger', monthlyFundingCents: 500_000, priority: 2 })]
    const before = cockpitFor({ cashCents: 2_000_000, safetyMarginCents: 500_000, goals })
    const s = settings({ ownerSalaryMonthlyCents: 300_000, ownerSalaryMonths: 3 })
    const plan = planMonthlyAllocation(before, goals, s)

    // Apply the plan exactly as the cron does, then recompute from scratch.
    const appliedGoals = goals.map(g => {
      const d = plan.deltas.find(x => x.goalId === g.id)
      return d ? { ...g, fundedCents: d.toCents } : g
    })
    const salaryDelta = plan.deltas.find(d => d.kind === 'owner_salary')
    const after = computeCockpit({
      today: TODAY,
      horizon: '3m',
      cash: { clearedCents: 2_000_000, pendingOutCents: 0, pendingInCents: 0, source: 'manual', asOf: null },
      obligations: [],
      operationalCoverageCents: 0,
      ownerSalary: { monthlyCents: 300_000, months: 3, coverageCents: salaryDelta?.toCents ?? 0 },
      goals: appliedGoals.map(g => goalProgress(g, TODAY)),
      safetyMarginCents: 500_000,
    })

    expect(after.financialSpaceCents).toBeGreaterThanOrEqual(after.safetyMarginCents)
    expect(after.reserveOverrunCents).toBe(0)
    // And the plan consumed exactly the growth room it was allowed to.
    expect(before.availableForGrowthCents - plan.allocatedCents).toBe(after.availableForGrowthCents)
  })

  it('nothing is allocated when there is no room above the margin', () => {
    const c = cockpitFor({ cashCents: 100_000, safetyMarginCents: 500_000 })
    expect(c.availableForGrowthCents).toBe(0)

    const plan = planMonthlyAllocation(c, [goal()], settings({ ownerSalaryMonthlyCents: 100_000 }))
    expect(plan.allocatedCents).toBe(0)
    expect(plan.deltas).toEqual([])
    expect(plan.skipped.map(s => s.reason)).toEqual(['no_room', 'no_room'])
  })

  it('a cockpit already under water allocates nothing', () => {
    const c = cockpitFor({ cashCents: 50_000, operationalCents: 900_000, safetyMarginCents: 100_000 })
    expect(c.reserveOverrunCents).toBeGreaterThan(0)
    const plan = planMonthlyAllocation(c, [goal()], settings())
    expect(plan.availableCents).toBe(0)
    expect(plan.allocatedCents).toBe(0)
  })
})

describe('planMonthlyAllocation — order', () => {
  it('funds the owner-salary buffer before goals by default', () => {
    const goals = [goal({ monthlyFundingCents: 400_000 })]
    const c = cockpitFor({ cashCents: 500_000, goals })
    const plan = planMonthlyAllocation(c, goals, settings({ ownerSalaryMonthlyCents: 100_000, ownerSalaryMonths: 3 }))

    expect(plan.deltas[0].kind).toBe('owner_salary')
    expect(plan.deltas[0].deltaCents).toBe(300_000) // 100.000 × 3, the full target
    expect(plan.deltas[1].goalId).toBe('g1')
    expect(plan.deltas[1].deltaCents).toBe(200_000) // what's left
  })

  it('an explicit priority can put goals before the salary buffer', () => {
    const goals = [goal({ monthlyFundingCents: 400_000 })]
    const c = cockpitFor({ cashCents: 500_000, goals })
    const plan = planMonthlyAllocation(c, goals, settings({
      ownerSalaryMonthlyCents: 100_000,
      priority: ['obligations', 'operational', 'goals', 'owner_salary'],
    }))

    expect(plan.deltas[0].kind).toBe('goal')
    expect(plan.deltas[0].deltaCents).toBe(400_000)
    expect(plan.deltas[1].kind).toBe('owner_salary')
    expect(plan.deltas[1].deltaCents).toBe(100_000)
  })

  it('goals are funded in priority order, and the lower-priority one takes what is left', () => {
    const goals = [
      goal({ id: 'low', name: 'Zonnepanelen', priority: 3, monthlyFundingCents: 300_000 }),
      goal({ id: 'high', name: 'Nieuwe motor', priority: 1, monthlyFundingCents: 300_000 }),
    ]
    const c = cockpitFor({ cashCents: 400_000, goals })
    const plan = planMonthlyAllocation(c, goals, settings())

    expect(plan.deltas.map(d => d.goalId)).toEqual(['high', 'low'])
    expect(plan.deltas[0].deltaCents).toBe(300_000)
    expect(plan.deltas[1].deltaCents).toBe(100_000)
    expect(plan.deltas[1].cappedBy).toBe('available')
  })

  it('same priority: the nearest deadline goes first, and an undated goal sorts last', () => {
    const goals = [
      goal({ id: 'undated', name: 'Zonder datum', deadline: null }),
      goal({ id: 'later', name: 'Later', deadline: '2027-06-01' }),
      goal({ id: 'sooner', name: 'Eerder', deadline: '2026-12-01' }),
    ]
    const c = cockpitFor({ cashCents: 10_000_000, goals })
    const plan = planMonthlyAllocation(c, goals, settings())
    expect(plan.deltas.map(d => d.goalId)).toEqual(['sooner', 'later', 'undated'])
  })
})

describe('planMonthlyAllocation — per-target caps', () => {
  it('never funds a goal past its target', () => {
    const goals = [goal({ targetCents: 250_000, fundedCents: 200_000, monthlyFundingCents: 100_000 })]
    const c = cockpitFor({ cashCents: 5_000_000, goals })
    const plan = planMonthlyAllocation(c, goals, settings())

    expect(plan.deltas[0].deltaCents).toBe(50_000) // not the full 100.000 monthly
    expect(plan.deltas[0].toCents).toBe(250_000)
    expect(plan.deltas[0].cappedBy).toBe('target')
  })

  it('never funds the salary buffer past monthly × months', () => {
    const c = cockpitFor({ cashCents: 5_000_000, salaryCoverageCents: 800_000 })
    const plan = planMonthlyAllocation(c, [], settings({
      ownerSalaryMonthlyCents: 300_000,
      ownerSalaryMonths: 3,
      ownerSalaryCoverageCents: 800_000,
    }))
    expect(plan.deltas[0].deltaCents).toBe(100_000) // 900.000 target − 800.000
    expect(plan.deltas[0].toCents).toBe(900_000)
    expect(plan.deltas[0].cappedBy).toBe('target')
  })

  it('a goal with no monthly amount is skipped, never guessed at', () => {
    const goals = [goal({ monthlyFundingCents: 0 })]
    const c = cockpitFor({ cashCents: 5_000_000, goals })
    const plan = planMonthlyAllocation(c, goals, settings())

    expect(plan.deltas).toEqual([])
    expect(plan.skipped[0]).toMatchObject({ goalId: 'g1', reason: 'no_plan' })
  })

  it('a goal already at its target is skipped as complete', () => {
    const goals = [goal({ targetCents: 500_000, fundedCents: 500_000 })]
    const c = cockpitFor({ cashCents: 5_000_000, goals })
    const plan = planMonthlyAllocation(c, goals, settings())
    expect(plan.skipped[0]).toMatchObject({ goalId: 'g1', reason: 'complete' })
  })

  it('a full salary buffer is reported complete; an unconfigured one says nothing at all', () => {
    const full = planMonthlyAllocation(cockpitFor({ cashCents: 5_000_000 }), [], settings({
      ownerSalaryMonthlyCents: 100_000, ownerSalaryMonths: 2, ownerSalaryCoverageCents: 200_000,
    }))
    expect(full.skipped).toEqual([{ kind: 'owner_salary', label: 'Eigenaarssalaris', wantedCents: 0, reason: 'complete' }])

    const unset = planMonthlyAllocation(cockpitFor({ cashCents: 5_000_000 }), [], settings())
    expect(unset.skipped).toEqual([])
    expect(unset.deltas).toEqual([])
  })
})

describe('formatAllocationSummary', () => {
  it('lists each top-up and what was held back', () => {
    const goals = [goal({ monthlyFundingCents: 100_000 }), goal({ id: 'g2', name: 'Steiger', priority: 2, monthlyFundingCents: 0 })]
    const c = cockpitFor({ cashCents: 300_000, goals })
    const plan = planMonthlyAllocation(c, goals, settings())
    const msg = formatAllocationSummary(plan)

    expect(msg).toContain('Maandelijkse toewijzing')
    expect(msg).toContain('• Nieuwe motor: +€1.000')
    expect(msg).toContain('Steiger: niets toegewezen (geen maandbedrag ingesteld)')
    expect(msg).toContain('Rest boven de veiligheidsmarge')
  })

  it('labels a dry run as a proef', () => {
    const goals = [goal()]
    const plan = planMonthlyAllocation(cockpitFor({ cashCents: 300_000, goals }), goals, settings())
    expect(formatAllocationSummary(plan, { dryRun: true })).toContain('(proef)')
  })

  it('says nothing when there is genuinely nothing to report', () => {
    const goals = [goal({ targetCents: 100_000, fundedCents: 100_000 })]
    const plan = planMonthlyAllocation(cockpitFor({ cashCents: 500_000, goals }), goals, settings())
    expect(formatAllocationSummary(plan)).toBe('')
  })
})
