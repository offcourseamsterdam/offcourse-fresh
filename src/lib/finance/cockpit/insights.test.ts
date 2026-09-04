import { describe, it, expect } from 'vitest'
import { buildInsights, sortInsights, type InsightInput } from './insights'
import { computeCockpit } from './compute'
import type { CockpitInputs, GoalProgress, ObligationOccurrence } from './types'

const TODAY = '2026-09-04'

const obl = (o: Partial<ObligationOccurrence> = {}): ObligationOccurrence => ({
  key: 'obl:1', title: 'BTW Q3', kind: 'tax', amountCents: 680_000, dueDate: '2026-10-31',
  source: 'obligation', sourceId: '1', overdue: false, ...o,
})

const goal = (o: Partial<GoalProgress> = {}): GoalProgress => ({
  id: 'g1', name: "Nieuwe accu's", targetCents: 1_000_000, fundedCents: 640_000,
  remainingCents: 360_000, progressPct: 64, plannedByNowCents: 640_000, behindCents: 0,
  monthsLeft: 9, onTrack: true, ...o,
})

/** A comfortable position: plenty of cash, everything covered. */
function healthy(over: Partial<CockpitInputs> = {}) {
  return computeCockpit({
    today: TODAY,
    horizon: '3m',
    cash: { clearedCents: 5_248_000, pendingOutCents: 0, pendingInCents: 0, source: 'revolut', asOf: '2026-09-04T09:42:00Z' },
    obligations: [obl({ amountCents: 1_840_000 })],
    operationalCoverageCents: 0,
    ownerSalary: { monthlyCents: 0, months: 3, coverageCents: 0 },
    goals: [],
    safetyMarginCents: 1_280_000,
    ...over,
  })
}

const input = (o: Partial<InsightInput> = {}): InsightInput => ({ cockpit: healthy(), now: TODAY, ...o })
const keys = (o: Partial<InsightInput> = {}) => buildInsights(input(o)).map(i => i.key)

describe('buildInsights — quiet when there is nothing to do', () => {
  it('says only what Beer opened the page for', () => {
    const list = buildInsights(input())
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ key: 'available-for-growth', level: 'info' })
    expect(list[0].message).toContain('€21.280')
  })

  it('says nothing at all when there is no growth room and no problem', () => {
    const cockpit = healthy({ safetyMarginCents: 3_500_000 })
    // space 34.080 < margin 35.000 → shortfall, so that warning is the only entry
    expect(buildInsights(input({ cockpit })).map(i => i.key)).toEqual(['below-safety-margin'])
  })
})

describe('buildInsights — critical', () => {
  it('reports a failing bank sync above everything else', () => {
    const list = sortInsights(buildInsights(input({ syncError: 'Revolut GET /accounts failed (500)' })))
    expect(list[0]).toMatchObject({ key: 'sync-error', level: 'critical' })
    expect(list[0].message).toContain('500')
  })

  it('never hides a reconciliation gap, and says it is excluded from free room', () => {
    const list = buildInsights(input({ reconciliationGapCents: -124_000 }))
    const gap = list.find(i => i.key === 'reconciliation-gap')!
    expect(gap.level).toBe('critical')
    expect(gap.message).toContain('€1.240')
    expect(gap.message).toMatch(/niet als vrije ruimte/)
  })

  it('flags an overdue obligation by name and date', () => {
    const cockpit = healthy({ obligations: [obl({ overdue: true, dueDate: '2026-08-01', amountCents: 90_000 })] })
    const list = buildInsights(input({ cockpit }))
    const item = list.find(i => i.key === 'overdue-obligations')!
    expect(item.message).toContain('BTW Q3')
    expect(item.message).toContain('01-08-2026')
  })

  it('summarises several overdue obligations instead of listing them all', () => {
    const cockpit = healthy({ obligations: [obl({ overdue: true, amountCents: 90_000 }), obl({ key: 'o2', overdue: true, amountCents: 10_000 })] })
    expect(buildInsights(input({ cockpit })).find(i => i.key === 'overdue-obligations')!.message)
      .toContain('2 verplichtingen')
  })

  it('tells you when reservations exceed the actual balance', () => {
    const cockpit = healthy({ cash: { clearedCents: 500_000, pendingOutCents: 0, pendingInCents: 0, source: 'revolut', asOf: null } })
    const item = buildInsights(input({ cockpit })).find(i => i.key === 'reserve-overrun')!
    expect(item.level).toBe('critical')
    expect(item.message).toContain('hoger dan je werkelijke saldo')
  })

  it('says plainly that the numbers are not yet trustworthy without a balance', () => {
    const cockpit = healthy({ cash: { clearedCents: 0, pendingOutCents: 0, pendingInCents: 0, source: 'none', asOf: null }, obligations: [] })
    expect(keys({ cockpit })).toContain('no-cash')
  })
})

describe('buildInsights — warnings', () => {
  it('reports the safety-margin shortfall with both amounts', () => {
    const cockpit = healthy({ cash: { clearedCents: 3_340_000, pendingOutCents: 0, pendingInCents: 0, source: 'revolut', asOf: null }, safetyMarginCents: 2_000_000 })
    const item = buildInsights(input({ cockpit })).find(i => i.key === 'below-safety-margin')!
    expect(item.message).toContain('€5.000')
    expect(item.message).toContain('€20.000')
  })

  it('names a single lagging goal, and counts them when there are more', () => {
    const one = healthy({ goals: [goal({ behindCents: 60_000, onTrack: false })] })
    expect(buildInsights(input({ cockpit: one })).find(i => i.key.startsWith('goal-behind'))!.message)
      .toBe("Nieuwe accu's loopt €600 achter op schema.")
    const two = healthy({ goals: [goal({ behindCents: 60_000, onTrack: false }), goal({ id: 'g2', name: 'Winter', behindCents: 40_000, onTrack: false })] })
    expect(buildInsights(input({ cockpit: two })).find(i => i.key === 'goals-behind')!.message)
      .toContain('2 doelen')
  })

  it('warns when the owner salary buffer is under a month', () => {
    const cockpit = healthy({ ownerSalary: { monthlyCents: 300_000, months: 3, coverageCents: 100_000 } })
    expect(keys({ cockpit })).toContain('owner-salary-thin')
  })

  it('only mentions obligations due soon when they are not fully covered', () => {
    const covered = healthy({ obligations: [obl({ dueDate: '2026-09-10', amountCents: 90_000 })] })
    expect(keys({ cockpit: covered })).not.toContain('obligations-due-soon')
    const uncovered = healthy({
      cash: { clearedCents: 50_000, pendingOutCents: 0, pendingInCents: 0, source: 'revolut', asOf: null },
      obligations: [obl({ dueDate: '2026-09-10', amountCents: 900_000 })],
    })
    expect(keys({ cockpit: uncovered })).toContain('obligations-due-soon')
  })
})

describe('buildInsights — review queue', () => {
  it('escalates to a warning when a big transaction is unreviewed', () => {
    const small = buildInsights(input({ needsReviewCount: 2, largestUnreviewedCents: 8_000 })).find(i => i.key === 'needs-review')!
    expect(small.level).toBe('info')
    const big = buildInsights(input({ needsReviewCount: 2, largestUnreviewedCents: 870_000 })).find(i => i.key === 'needs-review')!
    expect(big.level).toBe('warning')
    expect(big.message).toContain('€8.700')
  })

  it('uses singular wording for one transaction', () => {
    expect(buildInsights(input({ needsReviewCount: 1, largestUnreviewedCents: 4_500 })).find(i => i.key === 'needs-review')!.message)
      .toBe('1 transactie moet nog gecontroleerd worden (€45).')
  })

  it('mentions missing skipper invoices', () => {
    expect(buildInsights(input({ missingInvoiceCount: 3 })).find(i => i.key === 'missing-skipper-invoices')!.message)
      .toContain('3 gevaren tochten')
  })
})

describe('sortInsights', () => {
  it('puts critical first, then warnings, then info', () => {
    const list = buildInsights(input({ reconciliationGapCents: 100, needsReviewCount: 1, unclassifiedCount: 4 }))
    expect(sortInsights(list).map(i => i.level)).toEqual([...sortInsights(list)].map(i => i.level).sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a] - { critical: 0, warning: 1, info: 2 }[b])))
    expect(sortInsights(list)[0].level).toBe('critical')
  })
})
