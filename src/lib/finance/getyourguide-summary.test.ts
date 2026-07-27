import { describe, it, expect } from 'vitest'
import { aggregateGetYourGuideSummary, type GetYourGuidePaymentSummaryInput } from './getyourguide-summary'

function payment(overrides: Partial<GetYourGuidePaymentSummaryInput>): GetYourGuidePaymentSummaryInput {
  return { paymentRunDate: '2026-07-06', amountCents: 104814, revenueVatRate: 9, ...overrides }
}

describe('aggregateGetYourGuideSummary', () => {
  it('sums payments into a single quarter bucket', () => {
    const { quarters, totals } = aggregateGetYourGuideSummary([
      payment({ amountCents: 104814 }),
      payment({ amountCents: 50000 }),
    ])
    expect(quarters).toEqual([
      { quarter: '2026-Q3', paymentCount: 2, totalAmountCents: 154814, revenueExCents: 142032, revenueVatCents: 12782 },
    ])
    expect(totals).toEqual({ paymentCount: 2, totalAmountCents: 154814, revenueExCents: 142032, revenueVatCents: 12782 })
  })

  it('derives 9% output VAT on the net payout (no gross customer price exists for GetYourGuide)', () => {
    const { quarters } = aggregateGetYourGuideSummary([payment({ amountCents: 104814, revenueVatRate: 9 })])
    // 104814 / 1.09 = 96160 ex, 8654 VAT
    expect(quarters[0].revenueExCents).toBe(96160)
    expect(quarters[0].revenueVatCents).toBe(8654)
    expect(quarters[0].revenueExCents + quarters[0].revenueVatCents).toBe(104814)
  })

  it('buckets by the payment run date, not any booking sail date', () => {
    const { quarters } = aggregateGetYourGuideSummary([
      payment({ paymentRunDate: '2026-03-31' }),
      payment({ paymentRunDate: '2026-04-01' }),
    ])
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2026-Q1', '2026-Q2'])
  })

  it('sorts quarters newest first', () => {
    const { quarters } = aggregateGetYourGuideSummary([
      payment({ paymentRunDate: '2025-01-05' }),
      payment({ paymentRunDate: '2026-07-06' }),
    ])
    expect(quarters.map(q => q.quarter)).toEqual(['2026-Q3', '2025-Q1'])
  })

  it('accepts a custom periodOf function for month-level bucketing (BTW dashboard per-maand view)', () => {
    const { quarters } = aggregateGetYourGuideSummary(
      [payment({ paymentRunDate: '2026-07-06' }), payment({ paymentRunDate: '2026-07-20' }), payment({ paymentRunDate: '2026-08-01' })],
      date => date.slice(0, 7)
    )
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2026-07', '2026-08'])
    expect(quarters.find(q => q.quarter === '2026-07')?.paymentCount).toBe(2)
  })

  it('skips payments with no run date without crashing', () => {
    const { quarters, totals } = aggregateGetYourGuideSummary([payment({ paymentRunDate: null })])
    expect(quarters).toHaveLength(0)
    expect(totals.paymentCount).toBe(0)
  })

  it('returns all-zero totals for an empty payment list', () => {
    const { quarters, totals } = aggregateGetYourGuideSummary([])
    expect(quarters).toEqual([])
    expect(totals).toEqual({ paymentCount: 0, totalAmountCents: 0, revenueExCents: 0, revenueVatCents: 0 })
  })
})
