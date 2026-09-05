import { describe, it, expect } from 'vitest'
import { summarizeExpenses, vatQuarterOf, type ExpenseSummaryRow } from './summary'

const TODAY = new Date('2026-09-05T12:00:00Z') // Q3 2026
const row = (over: Partial<ExpenseSummaryRow> = {}): ExpenseSummaryRow => ({
  status: 'ready_for_snelstart', vat_cents: 2100, vat_source: 'invoice', vat_conflict: null, bank_transaction_id: 'tx', paid_at: '2026-08-15T10:00:00Z', invoice_date: null, created_at: '2026-08-15T10:00:00Z', ...over,
})

describe('summarizeExpenses', () => {
  it('counts every status, derives "open", and sums reclaimable VAT per quarter (current + previous)', () => {
    const s = summarizeExpenses([row(), row({ status: 'waiting_for_invoice', vat_source: null, vat_cents: null }), row({ status: 'ignored', vat_cents: 999 }), row({ paid_at: '2026-05-02T00:00:00Z', vat_cents: 900 })], null, TODAY)
    expect(s.counts.ready_for_snelstart).toBe(2)
    expect(s.counts.waiting_for_invoice).toBe(1)
    expect(s.counts.ignored).toBe(1)
    expect(s.open).toBe(3)
    expect(s.vat.map(q => q.quarter)).toEqual(['2026-Q3', '2026-Q2'])
    expect(s.vat[0]).toMatchObject({ reclaimableCents: 2100, pendingCents: 0, unresolvedCount: 1, conflictCount: 0, payableCents: null, positionCents: null })
    expect(s.vat[1].reclaimableCents).toBe(900)
  })

  it('ignored payments never count towards reclaimable VAT, unresolved or conflicts', () => {
    const s = summarizeExpenses([row({ status: 'ignored', vat_source: null, vat_conflict: { x: 1 } })], null, TODAY)
    expect(s.vat[0]).toMatchObject({ reclaimableCents: 0, unresolvedCount: 0, conflictCount: 0 })
  })

  it('nets the sales-side VAT against reclaimable purchase VAT when the BTW dashboard is available', () => {
    const btw = [{ quarter: '2026-Q3', vat9OwedCents: 5000, vat21OwedCents: 1000, vat21DeductibleCents: 500, netIndicationCents: 5500, bySource: {} }]
    const s = summarizeExpenses([row()], btw, TODAY)
    expect(s.vat[0]).toMatchObject({ payableCents: 5500, positionCents: 3400 })
    expect(s.vat[1].payableCents).toBeNull()
  })

  it('a VAT conflict is counted and its VAT excluded from both reclaimable and pending', () => {
    const s = summarizeExpenses([row({ vat_source: null, vat_conflict: { expected: 2100 } }), row({ status: 'needs_review', vat_conflict: { invoice: 2100, revolut: 900 } })], null, TODAY)
    expect(s.vat[0]).toMatchObject({ reclaimableCents: 0, pendingCents: 0, conflictCount: 2, unresolvedCount: 1 })
  })

  it('no invoice, no deduction: VAT known only from Revolut on a payment still waiting for its bon is pending, not reclaimable', () => {
    const s = summarizeExpenses([row({ status: 'waiting_for_invoice', vat_source: 'revolut', vat_cents: 1500 }), row({ status: 'partially_matched', vat_source: 'revolut', vat_cents: 500 }), row({ status: 'booked', vat_cents: 300 })], null, TODAY)
    expect(s.vat[0]).toMatchObject({ reclaimableCents: 300, pendingCents: 2000 })
  })

  it('quarter follows the payment date first, invoice date second, arrival last', () => {
    expect(vatQuarterOf({ paid_at: '2026-04-01T00:00:00Z', invoice_date: '2026-09-01', created_at: '2026-09-02T00:00:00Z' })).toBe('2026-Q2')
    expect(vatQuarterOf({ paid_at: null, invoice_date: '2026-09-01', created_at: '2026-12-02T00:00:00Z' })).toBe('2026-Q3')
    expect(vatQuarterOf({ paid_at: null, invoice_date: null, created_at: '2026-12-02T00:00:00Z' })).toBe('2026-Q4')
  })
})
