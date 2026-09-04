import { describe, it, expect } from 'vitest'
import { expandObligations, horizonEnd, sumObligations } from './obligations'
import type { LoanPaymentRow, ObligationRow } from './types'

const TODAY = '2026-09-04'

const row = (o: Partial<ObligationRow>): ObligationRow => ({
  id: 'o1',
  title: 'BTW Q3',
  kind: 'tax',
  amountCents: 680000,
  dueDate: '2026-10-31',
  recurrenceMonths: null,
  recurrenceUntil: null,
  status: 'open',
  ...o,
})

const pay = (o: Partial<LoanPaymentRow>): LoanPaymentRow => ({
  id: 'p1',
  loanId: 'l1',
  loanName: 'Lening Tijs',
  dueDate: '2026-10-01',
  interestCents: 18000,
  principalCents: 0,
  totalCents: 18000,
  isPaid: false,
  ...o,
})

describe('horizonEnd', () => {
  it('30 days / 3 months / 12 months from today', () => {
    expect(horizonEnd(TODAY, '30d')).toBe('2026-10-04')
    expect(horizonEnd(TODAY, '3m')).toBe('2026-12-04')
    expect(horizonEnd(TODAY, '12m')).toBe('2027-09-04')
  })
  it('clamps month-end (Jan 31 + 1 month → Feb 28)', () => {
    expect(horizonEnd('2027-01-31', '3m')).toBe('2027-04-30')
  })
})

describe('expandObligations', () => {
  it('includes one-off obligations due inside the horizon, excludes later ones', () => {
    const rows = [row({ id: 'a', dueDate: '2026-10-31' }), row({ id: 'b', title: 'Verzekering', kind: 'insurance', dueDate: '2027-02-01', amountCents: 240000 })]
    expect(expandObligations(rows, [], { today: TODAY, horizon: '3m' }).map(o => o.sourceId)).toEqual(['a'])
    expect(expandObligations(rows, [], { today: TODAY, horizon: '12m' }).map(o => o.sourceId)).toEqual(['a', 'b'])
  })

  it('an open obligation past its due date stays in, flagged overdue', () => {
    const [o] = expandObligations([row({ dueDate: '2026-08-01' })], [], { today: TODAY, horizon: '30d' })
    expect(o.overdue).toBe(true)
    expect(o.amountCents).toBe(680000)
  })

  it('paid and cancelled rows are ignored', () => {
    const rows = [row({ id: 'p', status: 'paid' }), row({ id: 'c', status: 'cancelled' })]
    expect(expandObligations(rows, [], { today: TODAY, horizon: '12m' })).toEqual([])
  })

  it('expands a recurring obligation to every occurrence inside the horizon, none before today', () => {
    const berth = row({ id: 'berth', title: 'Ligplaats', kind: 'berth', amountCents: 100000, dueDate: '2026-01-15', recurrenceMonths: 3 })
    const occ = expandObligations([berth], [], { today: TODAY, horizon: '12m' })
    expect(occ.map(o => o.dueDate)).toEqual(['2026-10-15', '2027-01-15', '2027-04-15', '2027-07-15'])
    expect(occ.every(o => !o.overdue)).toBe(true)
    expect(new Set(occ.map(o => o.key)).size).toBe(4)
  })

  it('respects recurrence_until', () => {
    const r = row({ id: 'r', dueDate: '2026-09-10', recurrenceMonths: 1, recurrenceUntil: '2026-11-30' })
    expect(expandObligations([r], [], { today: TODAY, horizon: '12m' }).map(o => o.dueDate)).toEqual(['2026-09-10', '2026-10-10', '2026-11-10'])
  })

  it('adds unpaid loan payments inside the horizon and skips paid ones', () => {
    const payments = [
      pay({ id: 'p1', dueDate: '2026-10-01', totalCents: 636600 }),
      pay({ id: 'p2', dueDate: '2027-04-01', totalCents: 1236200 }),
      pay({ id: 'p0', dueDate: '2026-04-01', totalCents: 100, isPaid: true }),
    ]
    const m3 = expandObligations([], payments, { today: TODAY, horizon: '3m' })
    expect(sumObligations(m3)).toBe(636600)
    const m12 = expandObligations([], payments, { today: TODAY, horizon: '12m' })
    expect(sumObligations(m12)).toBe(636600 + 1236200)
    expect(m12[0].title).toBe('Lening Tijs — rente')
  })

  it('never double-counts a loan: obligation rows of kind=loan are ignored in favour of loan payments', () => {
    const rows = [row({ id: 'dup', kind: 'loan', amountCents: 636600, dueDate: '2026-10-01' })]
    const occ = expandObligations(rows, [pay({ totalCents: 636600 })], { today: TODAY, horizon: '3m' })
    expect(occ).toHaveLength(1)
    expect(occ[0].source).toBe('loan')
  })

  it('sorts by due date', () => {
    const occ = expandObligations(
      [row({ id: 'late', dueDate: '2026-11-01' }), row({ id: 'early', dueDate: '2026-09-10' })],
      [pay({ dueDate: '2026-10-01' })],
      { today: TODAY, horizon: '3m' },
    )
    expect(occ.map(o => o.dueDate)).toEqual(['2026-09-10', '2026-10-01', '2026-11-01'])
  })
})
