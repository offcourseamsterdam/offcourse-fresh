import { describe, it, expect } from 'vitest'
import { categoryOf, groupObligations, groupPayees, CATEGORY_ORDER } from './categories'
import type { ObligationOccurrence } from './types'

function occ(overrides: Partial<ObligationOccurrence> = {}): ObligationOccurrence {
  return {
    key: 'obl:1', title: 'Test', kind: 'other', amountCents: 1000, dueDate: '2026-09-15',
    source: 'obligation', sourceId: '1', overdue: false, ...overrides,
  }
}

describe('categoryOf', () => {
  it('a loan payment is Rente + aflossing', () => {
    expect(categoryOf(occ({ kind: 'loan', key: 'loan:p1' }))).toBe('debt')
  })

  it('a skipper-hours crew accrual is Schippersuren', () => {
    expect(categoryOf(occ({ kind: 'crew' }))).toBe('crew')
  })

  it('an approved supplier invoice is Facturen', () => {
    expect(categoryOf(occ({ kind: 'invoice' }))).toBe('invoice')
  })

  it('insurance and berth both fold into Operationele vaste kosten', () => {
    expect(categoryOf(occ({ kind: 'insurance' }))).toBe('operational')
    expect(categoryOf(occ({ kind: 'berth' }))).toBe('operational')
  })

  it('a tax row with a vat: source key is BTW', () => {
    expect(categoryOf(occ({ kind: 'tax', sourceKey: 'vat:2026-08' }))).toBe('vat')
  })

  it('a tax row with a city-tax: source key is Toeristenbelasting', () => {
    expect(categoryOf(occ({ kind: 'tax', sourceKey: 'city-tax:2026-08' }))).toBe('city_tax')
  })

  it('a manually entered tax row (no source key at all) falls to Meer…', () => {
    expect(categoryOf(occ({ kind: 'tax', sourceKey: null }))).toBe('other')
  })

  it('a contract row with a partner-commission: source key is Partnercommissies', () => {
    expect(categoryOf(occ({ kind: 'contract', sourceKey: 'partner-commission:p1:2026-Q3' }))).toBe('commission')
  })

  it('contract without partner-commission key and other both fall to Meer…', () => {
    expect(categoryOf(occ({ kind: 'contract' }))).toBe('other')
    expect(categoryOf(occ({ kind: 'other' }))).toBe('other')
  })

  it('an unused salary-kind row (never Salaris eigenaar, which is buffer-only) also falls to Meer…', () => {
    expect(categoryOf(occ({ kind: 'salary' }))).toBe('other')
  })
})

describe('groupObligations', () => {
  it('groups, sums, counts overdue, and orders by CATEGORY_ORDER — skipping empty categories', () => {
    const groups = groupObligations([
      occ({ key: 'a', kind: 'invoice', amountCents: 500 }),
      occ({ key: 'b', kind: 'loan', amountCents: 200, overdue: true }),
      occ({ key: 'c', kind: 'invoice', amountCents: 300, overdue: true }),
    ])
    expect(groups.map(g => g.category)).toEqual(['debt', 'invoice']) // CATEGORY_ORDER, not insertion order
    const invoices = groups.find(g => g.category === 'invoice')!
    expect(invoices.totalCents).toBe(800)
    expect(invoices.overdueCount).toBe(1)
    expect(invoices.items).toHaveLength(2)
  })

  it('an empty list produces no groups', () => {
    expect(groupObligations([])).toEqual([])
  })

  it('every real ObligationKind maps to exactly one CATEGORY_ORDER entry (no group ever silently dropped)', () => {
    const kinds: ObligationOccurrence['kind'][] = ['tax', 'loan', 'insurance', 'berth', 'salary', 'crew', 'contract', 'invoice', 'other']
    for (const kind of kinds) {
      expect(CATEGORY_ORDER).toContain(categoryOf(occ({ kind, sourceKey: kind === 'tax' ? 'vat:2026-08' : null })))
    }
  })
})

describe('groupPayees', () => {
  it('groups items by trimmed title, sums amount, counts overdue, and sorts by total descending', () => {
    const payees = groupPayees([
      occ({ key: '1', title: 'Supabase', amountCents: 3000, overdue: false }),
      occ({ key: '2', title: 'Supabase', amountCents: 3500, overdue: true }),
      occ({ key: '3', title: 'Simyo', amountCents: 4800, overdue: false }),
    ])

    expect(payees).toHaveLength(2)
    expect(payees[0].payee).toBe('Supabase')
    expect(payees[0].totalCents).toBe(6500)
    expect(payees[0].overdueCount).toBe(1)
    expect(payees[0].items).toHaveLength(2)

    expect(payees[1].payee).toBe('Simyo')
    expect(payees[1].totalCents).toBe(4800)
    expect(payees[1].overdueCount).toBe(0)
  })

  it('handles empty title by falling back to Overig', () => {
    const payees = groupPayees([occ({ key: '1', title: '', amountCents: 1000 })])
    expect(payees[0].payee).toBe('Overig')
  })
})

