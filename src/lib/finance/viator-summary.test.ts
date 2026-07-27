import { describe, it, expect } from 'vitest'
import { aggregateViatorSummary, type ViatorBatchSummaryInput } from './viator-summary'

function batch(overrides: Partial<ViatorBatchSummaryInput>): ViatorBatchSummaryInput {
  return { adviceDate: '2026-07-08', totalAmountCents: 173492, lineCount: 4, revenueVatRate: 9, ...overrides }
}

describe('aggregateViatorSummary', () => {
  it('sums batches into a single quarter bucket', () => {
    const { quarters, totals } = aggregateViatorSummary([
      batch({ totalAmountCents: 173492, lineCount: 4 }),
      batch({ totalAmountCents: 50000, lineCount: 2 }),
    ])

    expect(quarters).toEqual([
      { quarter: '2026-Q3', batchCount: 2, bookingCount: 6, totalAmountCents: 223492, revenueExCents: 205039, revenueVatCents: 18453 },
    ])
    expect(totals).toEqual({ batchCount: 2, bookingCount: 6, totalAmountCents: 223492, revenueExCents: 205039, revenueVatCents: 18453 })
  })

  it('derives 9% output VAT on the net payout (Viator states no gross customer price)', () => {
    const { quarters } = aggregateViatorSummary([batch({ totalAmountCents: 173492, revenueVatRate: 9 })])
    // 173492 / 1.09 = 159167 ex, 14325 VAT
    expect(quarters[0].revenueExCents).toBe(159167)
    expect(quarters[0].revenueVatCents).toBe(14325)
    expect(quarters[0].revenueExCents + quarters[0].revenueVatCents).toBe(173492)
  })

  it('buckets by the advice date (payout date), not any booking sail date', () => {
    const { quarters } = aggregateViatorSummary([
      batch({ adviceDate: '2026-03-31' }),
      batch({ adviceDate: '2026-04-01' }),
    ])
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2026-Q1', '2026-Q2'])
  })

  it('sorts quarters newest first', () => {
    const { quarters } = aggregateViatorSummary([
      batch({ adviceDate: '2025-01-05' }),
      batch({ adviceDate: '2026-07-08' }),
    ])
    expect(quarters.map(q => q.quarter)).toEqual(['2026-Q3', '2025-Q1'])
  })

  it('accepts a custom periodOf function for month-level bucketing (BTW dashboard per-maand view)', () => {
    const { quarters } = aggregateViatorSummary(
      [batch({ adviceDate: '2026-07-08' }), batch({ adviceDate: '2026-07-20' }), batch({ adviceDate: '2026-08-01' })],
      date => date.slice(0, 7)
    )
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2026-07', '2026-08'])
    expect(quarters.find(q => q.quarter === '2026-07')?.batchCount).toBe(2)
  })

  it('skips batches with no advice date without crashing', () => {
    const { quarters, totals } = aggregateViatorSummary([batch({ adviceDate: null })])
    expect(quarters).toHaveLength(0)
    expect(totals.batchCount).toBe(0)
  })

  it('returns all-zero totals for an empty batch list', () => {
    const { quarters, totals } = aggregateViatorSummary([])
    expect(quarters).toEqual([])
    expect(totals).toEqual({ batchCount: 0, bookingCount: 0, totalAmountCents: 0, revenueExCents: 0, revenueVatCents: 0 })
  })
})
