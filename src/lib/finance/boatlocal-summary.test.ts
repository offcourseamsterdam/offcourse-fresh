import { describe, it, expect } from 'vitest'
import { aggregateBoatLocalSummary, type BoatLocalBatchSummaryInput } from './boatlocal-summary'

function batch(overrides: Partial<BoatLocalBatchSummaryInput>): BoatLocalBatchSummaryInput {
  return { issueDate: '2026-07-08', operatorPayoutCents: 19061, vat9InPayoutCents: 1574, vat21Cents: 944, lineCount: 1, ...overrides }
}

describe('aggregateBoatLocalSummary', () => {
  it('sums batches into a single quarter bucket', () => {
    const { quarters, totals } = aggregateBoatLocalSummary([
      batch({ operatorPayoutCents: 19061, vat9InPayoutCents: 1574, vat21Cents: 944, lineCount: 1 }),
      batch({ operatorPayoutCents: 5000, vat9InPayoutCents: 400, vat21Cents: 100, lineCount: 2 }),
    ])
    expect(quarters).toEqual([
      { quarter: '2026-Q3', batchCount: 2, bookingCount: 3, operatorPayoutCents: 24061, vat9InPayoutCents: 1974, vat21Cents: 1044 },
    ])
    expect(totals).toEqual({ batchCount: 2, bookingCount: 3, operatorPayoutCents: 24061, vat9InPayoutCents: 1974, vat21Cents: 1044 })
  })

  it('tracks the 21% commission VAT (deductible input VAT) separately from the 9% owed', () => {
    const { totals } = aggregateBoatLocalSummary([batch({ vat9InPayoutCents: 1574, vat21Cents: 944 })])
    expect(totals.vat9InPayoutCents).toBe(1574)
    expect(totals.vat21Cents).toBe(944)
  })

  it('accepts a custom periodOf function for month-level bucketing (BTW dashboard per-maand view)', () => {
    const { quarters } = aggregateBoatLocalSummary(
      [batch({ issueDate: '2026-07-08' }), batch({ issueDate: '2026-07-20' }), batch({ issueDate: '2026-08-01' })],
      date => date.slice(0, 7)
    )
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2026-07', '2026-08'])
    expect(quarters.find(q => q.quarter === '2026-07')?.batchCount).toBe(2)
  })

  it('buckets by the issue date (payout date), not the invoice period', () => {
    const { quarters } = aggregateBoatLocalSummary([
      batch({ issueDate: '2026-03-31' }),
      batch({ issueDate: '2026-04-01' }),
    ])
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2026-Q1', '2026-Q2'])
  })

  it('sorts quarters newest first', () => {
    const { quarters } = aggregateBoatLocalSummary([
      batch({ issueDate: '2025-05-08' }),
      batch({ issueDate: '2026-07-08' }),
    ])
    expect(quarters.map(q => q.quarter)).toEqual(['2026-Q3', '2025-Q2'])
  })

  it('skips batches with no issue date without crashing', () => {
    const { quarters, totals } = aggregateBoatLocalSummary([batch({ issueDate: null })])
    expect(quarters).toHaveLength(0)
    expect(totals.batchCount).toBe(0)
  })

  it('returns all-zero totals for an empty batch list', () => {
    const { quarters, totals } = aggregateBoatLocalSummary([])
    expect(quarters).toEqual([])
    expect(totals).toEqual({ batchCount: 0, bookingCount: 0, operatorPayoutCents: 0, vat9InPayoutCents: 0, vat21Cents: 0 })
  })
})
