import { describe, it, expect } from 'vitest'
import { aggregateBarqoSummary, type BarqoBookingSummaryInput } from './barqo-summary'

// Sabine's real booking: €300.00 gross (Barqo dashboard), €249.00 net payout
// (confirmed against Beer's bank ledger, "STRIPE Payment from Stripe BARQO
// PAYMENTS", 2025-07-16) — the €51.00 gap is Barqo's commission incl. 21% VAT.
function booking(overrides: Partial<BarqoBookingSummaryInput> = {}): BarqoBookingSummaryInput {
  return {
    tripDate: '2025-07-13',
    priceCents: 30000,
    netPayoutCents: 24900,
    revenueVatRate: 9,
    ...overrides,
  }
}

describe('aggregateBarqoSummary', () => {
  it('buckets a booking by its trip quarter', () => {
    const { quarters } = aggregateBarqoSummary([booking()])
    expect(quarters).toHaveLength(1)
    expect(quarters[0].quarter).toBe('2025-Q3')
    expect(quarters[0].bookingCount).toBe(1)
  })

  it('derives 9% output VAT over the NET payout, not the gross price', () => {
    const { quarters } = aggregateBarqoSummary([booking({ priceCents: 30000, netPayoutCents: 24900 })])
    // 24900 / 1.09 = 22844 ex, 2056 VAT — over the €249 payout, not €300
    expect(quarters[0].revenueExCents).toBe(22844)
    expect(quarters[0].revenueVatCents).toBe(2056)
    expect(quarters[0].revenueExCents + quarters[0].revenueVatCents).toBe(24900)
  })

  it('derives 21% deductible VAT on the gross-minus-net commission gap', () => {
    const { quarters } = aggregateBarqoSummary([booking({ priceCents: 30000, netPayoutCents: 24900 })])
    // gap = 30000 - 24900 = 5100; 5100 / 1.21 = 4215 ex, 885 VAT
    expect(quarters[0].commissionExCents).toBe(4215)
    expect(quarters[0].commissionVatCents).toBe(885)
    expect(quarters[0].commissionExCents + quarters[0].commissionVatCents).toBe(5100)
  })

  it('falls back to treating the gross price as its own net when no payout is confirmed yet', () => {
    const { quarters } = aggregateBarqoSummary([booking({ priceCents: 30000, netPayoutCents: null })])
    // same as the old single-figure behaviour: 30000 / 1.09 = 27523 ex, 2477 VAT
    expect(quarters[0].netPayoutCents).toBe(30000)
    expect(quarters[0].revenueExCents).toBe(27523)
    expect(quarters[0].revenueVatCents).toBe(2477)
    expect(quarters[0].commissionExCents).toBe(0)
    expect(quarters[0].commissionVatCents).toBe(0)
  })

  it('sums two bookings landing in the same quarter', () => {
    const { quarters, totals } = aggregateBarqoSummary([
      booking({ tripDate: '2025-07-13', priceCents: 30000, netPayoutCents: 24900 }),
      booking({ tripDate: '2025-07-20', priceCents: 30000, netPayoutCents: 24900 }),
    ])
    expect(quarters).toHaveLength(1)
    expect(quarters[0].bookingCount).toBe(2)
    expect(quarters[0].priceCents).toBe(60000)
    expect(quarters[0].netPayoutCents).toBe(49800)
    expect(quarters[0].revenueVatCents).toBe(4112)
    expect(totals.priceCents).toBe(60000)
  })

  it('the two real known bookings (Sabine Jul + Frank Jun) land in different quarters', () => {
    const { quarters } = aggregateBarqoSummary([
      booking({ tripDate: '2025-07-13', priceCents: 30000, netPayoutCents: 24900 }),
      booking({ tripDate: '2025-06-26', priceCents: 30000, netPayoutCents: null }),
    ])
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2025-Q2', '2025-Q3'])
  })

  it('accepts a custom periodOf function for month-level bucketing (BTW dashboard per-maand view)', () => {
    const { quarters } = aggregateBarqoSummary(
      [booking({ tripDate: '2025-07-13' }), booking({ tripDate: '2025-06-26', netPayoutCents: null })],
      date => date.slice(0, 7)
    )
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2025-06', '2025-07'])
    expect(quarters.find(q => q.quarter === '2025-07')?.bookingCount).toBe(1)
  })

  it('falls back to the default 9% rate when none is given', () => {
    const { quarters } = aggregateBarqoSummary([booking({ revenueVatRate: null })])
    expect(quarters[0].revenueVatCents).toBe(2056)
  })

  it('skips bookings with no trip date rather than crashing', () => {
    const { quarters, totals } = aggregateBarqoSummary([booking({ tripDate: null })])
    expect(quarters).toEqual([])
    expect(totals.bookingCount).toBe(0)
  })

  it('returns all-zero totals for an empty booking list', () => {
    const { quarters, totals } = aggregateBarqoSummary([])
    expect(quarters).toEqual([])
    expect(totals).toEqual({
      bookingCount: 0, priceCents: 0, netPayoutCents: 0,
      revenueExCents: 0, revenueVatCents: 0, commissionExCents: 0, commissionVatCents: 0,
    })
  })
})
