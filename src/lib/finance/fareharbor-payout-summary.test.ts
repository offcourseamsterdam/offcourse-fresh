import { describe, it, expect } from 'vitest'
import { aggregateFareHarborPayoutSummary, type FareHarborPayoutSummaryInput } from './fareharbor-payout-summary'

function payout(overrides: Partial<FareHarborPayoutSummaryInput> = {}): FareHarborPayoutSummaryInput {
  return {
    bankPayoutDate: '2025-07-21',
    grossCents: 27040,
    netCents: 26415,
    vat9Cents: 2233,
    vat21Cents: 0,
    ...overrides,
  }
}

describe('aggregateFareHarborPayoutSummary', () => {
  it('buckets a payout by the quarter its money actually landed in the bank', () => {
    const { quarters } = aggregateFareHarborPayoutSummary([payout()])
    expect(quarters).toHaveLength(1)
    expect(quarters[0].quarter).toBe('2025-Q3')
    expect(quarters[0].payoutCount).toBe(1)
  })

  it('sums both VAT rates as owed — both count directly, no deductible bucket', () => {
    const { quarters } = aggregateFareHarborPayoutSummary([
      payout({ vat9Cents: 2233, vat21Cents: 0 }),
    ])
    expect(quarters[0].vat9Cents).toBe(2233)
    expect(quarters[0].vat21Cents).toBe(0)
  })

  it('sums two payouts landing in the same quarter (real bank date, not FareHarbor\'s own reported date)', () => {
    const { quarters, totals } = aggregateFareHarborPayoutSummary([
      payout({ bankPayoutDate: '2025-07-21', netCents: 26415 }),
      payout({ bankPayoutDate: '2025-08-05', netCents: 16107 }),
    ])
    expect(quarters).toHaveLength(1)
    expect(quarters[0].payoutCount).toBe(2)
    expect(quarters[0].netCents).toBe(42522)
    expect(totals.netCents).toBe(42522)
  })

  it('accepts a custom periodOf function for month-level bucketing (BTW dashboard per-maand view)', () => {
    const { quarters } = aggregateFareHarborPayoutSummary(
      [payout({ bankPayoutDate: '2025-07-21' }), payout({ bankPayoutDate: '2025-08-05' })],
      date => date.slice(0, 7)
    )
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2025-07', '2025-08'])
  })

  it('handles a refund-heavy payout with negative net/vat', () => {
    const { quarters } = aggregateFareHarborPayoutSummary([
      payout({ grossCents: -7000, netCents: -6816, vat9Cents: -578 }),
    ])
    expect(quarters[0].netCents).toBe(-6816)
    expect(quarters[0].vat9Cents).toBe(-578)
  })

  it('tracks payouts with no confirmed bank date separately, rather than dropping or guessing them', () => {
    const { quarters, totals } = aggregateFareHarborPayoutSummary([
      payout({ bankPayoutDate: null, netCents: 30560 }),
    ])
    expect(quarters).toEqual([])
    expect(totals.payoutCount).toBe(0)
    expect(totals.unconfirmedCount).toBe(1)
    expect(totals.unconfirmedNetCents).toBe(30560)
  })

  it('returns all-zero totals for an empty payout list', () => {
    const { quarters, totals } = aggregateFareHarborPayoutSummary([])
    expect(quarters).toEqual([])
    expect(totals).toEqual({
      payoutCount: 0, grossCents: 0, netCents: 0, vat9Cents: 0, vat21Cents: 0,
      unconfirmedCount: 0, unconfirmedNetCents: 0,
    })
  })
})
