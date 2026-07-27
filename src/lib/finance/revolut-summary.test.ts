import { describe, it, expect } from 'vitest'
import { aggregateRevolutSummary, type RevolutTransactionSummaryInput } from './revolut-summary'

function tx(overrides: Partial<RevolutTransactionSummaryInput> = {}): RevolutTransactionSummaryInput {
  return {
    payoutDate: '2025-08-22',
    originalAmountCents: 41000,
    vat9GrossCents: 41000,
    vat21GrossCents: 0,
    ...overrides,
  }
}

describe('aggregateRevolutSummary', () => {
  it('buckets a transaction by the quarter it was actually paid out, not when the customer paid', () => {
    const { quarters } = aggregateRevolutSummary([tx()])
    expect(quarters).toHaveLength(1)
    expect(quarters[0].quarter).toBe('2025-Q3')
  })

  it('derives 9% output VAT from a fully-cruise-classified transaction', () => {
    // real: "Sail 21 August 1.5 hour tour", €410.00, 100% cruise
    const { quarters } = aggregateRevolutSummary([tx({ originalAmountCents: 41000, vat9GrossCents: 41000, vat21GrossCents: 0 })])
    expect(quarters[0].vat9VatCents).toBe(3385)
    expect(quarters[0].vat21VatCents).toBe(0)
  })

  it('splits a single transaction across both rates (the real mixed-charge case)', () => {
    // real: "Vaartocht sail 22 augustus 2 uur + 2 t shirts", €300.00 total,
    // Beer confirmed €250 cruise (9%) + €50 merch (21%)
    const { quarters } = aggregateRevolutSummary([
      tx({ originalAmountCents: 30000, vat9GrossCents: 25000, vat21GrossCents: 5000 }),
    ])
    expect(quarters[0].vat9VatCents).toBe(2064)
    expect(quarters[0].vat21VatCents).toBe(868)
    expect(quarters[0].unclassifiedCount).toBe(0)
  })

  it('counts an unclassified transaction (both gross fields null) toward unclassified, contributing zero VAT', () => {
    const { quarters } = aggregateRevolutSummary([
      tx({ originalAmountCents: 24750, vat9GrossCents: null, vat21GrossCents: null }),
    ])
    expect(quarters[0].vat9VatCents).toBe(0)
    expect(quarters[0].vat21VatCents).toBe(0)
    expect(quarters[0].unclassifiedCount).toBe(1)
    expect(quarters[0].unclassifiedAmountCents).toBe(24750)
    // the original amount still counts toward total revenue even though unclassified
    expect(quarters[0].originalAmountCents).toBe(24750)
  })

  it('sums multiple transactions in the same quarter', () => {
    const { quarters, totals } = aggregateRevolutSummary([
      tx({ payoutDate: '2025-08-22', originalAmountCents: 41000, vat9GrossCents: 41000, vat21GrossCents: 0 }),
      tx({ payoutDate: '2025-09-13', originalAmountCents: 1550, vat9GrossCents: 0, vat21GrossCents: 1550 }),
    ])
    expect(quarters).toHaveLength(1)
    expect(quarters[0].transactionCount).toBe(2)
    expect(totals.originalAmountCents).toBe(42550)
  })

  it('accepts a custom periodOf function for month-level bucketing (BTW dashboard per-maand view)', () => {
    const { quarters } = aggregateRevolutSummary(
      [tx({ payoutDate: '2025-08-22' }), tx({ payoutDate: '2025-09-13' })],
      date => date.slice(0, 7)
    )
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2025-08', '2025-09'])
  })

  it('tracks a transaction with no payout date yet as unpaid, rather than bucketing it into a guessed quarter', () => {
    const { quarters, totals } = aggregateRevolutSummary([tx({ payoutDate: null, originalAmountCents: 30106 })])
    expect(quarters).toEqual([])
    expect(totals.transactionCount).toBe(0)
    expect(totals.unpaidCount).toBe(1)
    expect(totals.unpaidAmountCents).toBe(30106)
  })

  it('returns all-zero totals for an empty transaction list', () => {
    const { quarters, totals } = aggregateRevolutSummary([])
    expect(quarters).toEqual([])
    expect(totals).toEqual({
      transactionCount: 0, originalAmountCents: 0, vat9GrossCents: 0, vat9VatCents: 0,
      vat21GrossCents: 0, vat21VatCents: 0, unclassifiedCount: 0, unclassifiedAmountCents: 0,
      unpaidCount: 0, unpaidAmountCents: 0,
    })
  })
})
