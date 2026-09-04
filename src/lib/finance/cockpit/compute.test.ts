import { describe, it, expect } from 'vitest'
import { computeCockpit } from './compute'
import type { CockpitInputs, GoalProgress, ObligationOccurrence } from './types'

const TODAY = '2026-09-04'

const obl = (o: Partial<ObligationOccurrence>): ObligationOccurrence => ({
  key: 'obl:1',
  title: 'BTW Q3',
  kind: 'tax',
  amountCents: 680000,
  dueDate: '2026-10-31',
  source: 'obligation',
  sourceId: '1',
  overdue: false,
  ...o,
})

const goal = (o: Partial<GoalProgress>): GoalProgress => ({
  id: 'g1',
  name: "Nieuwe accu's",
  targetCents: 1000000,
  fundedCents: 640000,
  remainingCents: 360000,
  progressPct: 64,
  plannedByNowCents: 640000,
  behindCents: 0,
  monthsLeft: 9,
  onTrack: true,
  ...o,
})

const base = (o: Partial<CockpitInputs> = {}): CockpitInputs => ({
  today: TODAY,
  horizon: '3m',
  cash: { clearedCents: 5248000, pendingOutCents: 0, pendingInCents: 0, source: 'revolut', asOf: '2026-09-04T09:42:00Z' },
  obligations: [obl({ amountCents: 1840000 })],
  operationalCoverageCents: 0,
  ownerSalary: { monthlyCents: 0, months: 3, coverageCents: 0 },
  goals: [],
  safetyMarginCents: 1280000,
  ...o,
})

describe('computeCockpit — the PRD canonical example (§3.5)', () => {
  it('€52.480 − €18.400 = €34.080 space; − €12.800 margin = €21.280 growth', () => {
    const r = computeCockpit(base())
    expect(r.financialSpaceCents).toBe(3408000)
    expect(r.availableForGrowthCents).toBe(2128000)
    expect(r.marginShortfallCents).toBe(0)
    expect(r.status.level).toBe('healthy')
  })

  it('with a €20.000 margin the same space yields €14.080', () => {
    const r = computeCockpit(base({ safetyMarginCents: 2000000 }))
    expect(r.financialSpaceCents).toBe(3408000)
    expect(r.availableForGrowthCents).toBe(1408000)
  })
})

describe('computeCockpit — growth is floored at zero, shortfall shown separately (§3.4)', () => {
  it('space €15.000 vs margin €20.000 → growth €0, €5.000 under the margin, status Let op', () => {
    const r = computeCockpit(base({ cash: { ...base().cash, clearedCents: 3340000 }, safetyMarginCents: 2000000 }))
    expect(r.financialSpaceCents).toBe(1500000)
    expect(r.availableForGrowthCents).toBe(0)
    expect(r.marginShortfallCents).toBe(500000)
    expect(r.status.level).toBe('attention')
    expect(r.status.reasons[0]).toContain('5.000')
  })
})

describe('computeCockpit — every requirement is deducted exactly once', () => {
  it('obligations + operational + salary + goals', () => {
    const r = computeCockpit(base({
      operationalCoverageCents: 720000,
      ownerSalary: { monthlyCents: 300000, months: 3, coverageCents: 900000 },
      goals: [goal({}), goal({ id: 'g2', name: 'Winteronderhoud', fundedCents: 320000, targetCents: 500000 })],
    }))
    expect(r.requiredCents).toBe(1840000 + 720000 + 900000 + 640000 + 320000)
    expect(r.financialSpaceCents).toBe(5248000 - 4420000)
    expect(r.buckets.map(b => [b.key, b.requiredCents])).toEqual([
      ['obligations', 1840000],
      ['operational', 720000],
      ['owner_salary', 900000],
      ['goals', 960000],
    ])
    expect(r.ownerSalary.targetCents).toBe(900000)
    expect(r.ownerSalary.monthsCovered).toBe(3)
  })

  it('the safety margin is never a bucket', () => {
    const r = computeCockpit(base())
    expect(r.buckets.map(b => b.key)).not.toContain('safety_margin')
    expect(r.buckets).toHaveLength(4)
  })
})

describe('computeCockpit — the allocation bar reconciles to cleared cash', () => {
  it('funded buckets + free = cash, always', () => {
    for (const cash of [0, 500000, 1840000, 3000000, 5248000, 9999999]) {
      const r = computeCockpit(base({
        cash: { ...base().cash, clearedCents: cash },
        operationalCoverageCents: 720000,
        ownerSalary: { monthlyCents: 300000, months: 3, coverageCents: 900000 },
        goals: [goal({})],
      }))
      const funded = r.buckets.reduce((s, b) => s + b.fundedCents, 0)
      expect(funded + r.freeCents).toBe(cash)
      expect(r.freeCents).toBeGreaterThanOrEqual(0)
    }
  })

  it('cash runs out in priority order: obligations first, goals last', () => {
    const r = computeCockpit(base({
      cash: { ...base().cash, clearedCents: 2000000 },
      operationalCoverageCents: 720000,
      ownerSalary: { monthlyCents: 300000, months: 3, coverageCents: 900000 },
      goals: [goal({})],
    }))
    expect(r.buckets.map(b => [b.key, b.fundedCents, b.shortfallCents])).toEqual([
      ['obligations', 1840000, 0],
      ['operational', 160000, 560000],
      ['owner_salary', 0, 900000],
      ['goals', 0, 640000],
    ])
    expect(r.freeCents).toBe(0)
    expect(r.financialSpaceCents).toBe(2000000 - 4100000)
    expect(r.reserveOverrunCents).toBe(2100000)
    expect(r.availableForGrowthCents).toBe(0)
    expect(r.status.level).toBe('tight')
  })

  it('a custom priority order is respected; unknown keys ignored, missing keys appended', () => {
    const r = computeCockpit(base({
      cash: { ...base().cash, clearedCents: 1000000 },
      goals: [goal({})],
      priority: ['goals', 'bogus' as never],
    }))
    expect(r.buckets.map(b => b.key)).toEqual(['goals', 'obligations', 'operational', 'owner_salary'])
    expect(r.buckets[0].fundedCents).toBe(640000)
  })
})

describe('computeCockpit — status', () => {
  it('healthy when everything is covered and space ≥ margin', () => {
    expect(computeCockpit(base()).status.level).toBe('healthy')
  })
  it('tight when an obligation is underfunded', () => {
    const r = computeCockpit(base({ cash: { ...base().cash, clearedCents: 1000000 } }))
    expect(r.status.level).toBe('tight')
    expect(r.status.reasons.join(' ')).toContain('onderdekt')
  })
  it('tight when an obligation is overdue even if cash covers it', () => {
    const r = computeCockpit(base({ obligations: [obl({ overdue: true, dueDate: '2026-08-01' })] }))
    expect(r.status.level).toBe('tight')
  })
  it('tight when no balance is known at all', () => {
    const r = computeCockpit(base({ cash: { clearedCents: 0, pendingOutCents: 0, pendingInCents: 0, source: 'none', asOf: null }, obligations: [] }))
    expect(r.status.level).toBe('tight')
    expect(r.status.reasons[0]).toContain('Revolut')
  })
  it('attention when a goal is behind schedule', () => {
    const r = computeCockpit(base({ goals: [goal({ behindCents: 60000, onTrack: false })] }))
    expect(r.status.level).toBe('attention')
    expect(r.status.reasons[0]).toContain('600')
  })
  it('attention when owner salary is under a month covered', () => {
    const r = computeCockpit(base({ ownerSalary: { monthlyCents: 300000, months: 3, coverageCents: 100000 } }))
    expect(r.status.level).toBe('attention')
    expect(r.ownerSalary.monthsCovered).toBe(0.3)
  })
})

describe('computeCockpit — cash hygiene', () => {
  it('pending amounts never change the numbers, only the explanation', () => {
    const a = computeCockpit(base())
    const b = computeCockpit(base({ cash: { ...base().cash, pendingOutCents: 45000, pendingInCents: 400000 } }))
    expect(b.financialSpaceCents).toBe(a.financialSpaceCents)
    expect(b.availableForGrowthCents).toBe(a.availableForGrowthCents)
    expect(b.why.find(l => l.op === 'info')?.label).toContain('In behandeling')
    expect(a.why.find(l => l.op === 'info')).toBeUndefined()
  })
  it('negative cleared cash is treated as zero', () => {
    expect(computeCockpit(base({ cash: { ...base().cash, clearedCents: -100 } })).freeCents).toBe(0)
  })
})

describe('computeCockpit — "Waarom?"', () => {
  it('lists start, every deduction, the subtotal, the margin and the result in order', () => {
    const r = computeCockpit(base({ goals: [goal({})], ownerSalary: { monthlyCents: 300000, months: 3, coverageCents: 900000 } }))
    expect(r.why.map(l => l.op)).toEqual(['start', '-', '-', '-', '-', '=', '-', '='])
    expect(r.why[0].amountCents).toBe(5248000)
    expect(r.why[1].label).toContain('komende 3 maanden')
    expect(r.why[1].detail).toContain('BTW Q3')
    expect(r.why[5]).toMatchObject({ label: 'Financiële ruimte vóór veiligheidsmarge', amountCents: 5248000 - 1840000 - 900000 - 640000 })
    expect(r.why.at(-1)).toMatchObject({ label: 'Beschikbaar voor groei' })
  })
  it('states the horizon end date', () => {
    expect(computeCockpit(base()).horizonEnd).toBe('2026-12-04')
    expect(computeCockpit(base({ horizon: '30d' })).horizonEnd).toBe('2026-10-04')
  })
})
