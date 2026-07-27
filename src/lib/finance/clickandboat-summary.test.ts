import { describe, it, expect } from 'vitest'
import { aggregateClickAndBoatSummary, type ClickAndBoatBookingSummaryInput } from './clickandboat-summary'

// Booking shaped like the real invoice #1208047: €250 gross renter total,
// €197 net amount to Off Course. Beer confirmed 9% goes over the €197 net
// amount — the opposite of Withlocals, where it's the gross tour price.
function booking(overrides: Partial<ClickAndBoatBookingSummaryInput> = {}): ClickAndBoatBookingSummaryInput {
  return {
    charterStartDate: '2025-09-13',
    grossAmountCents: 25000,
    netAmountCents: 19700,
    revenueVatRate: 9,
    ...overrides,
  }
}

describe('aggregateClickAndBoatSummary', () => {
  it('buckets a booking by its charter quarter', () => {
    const { quarters } = aggregateClickAndBoatSummary([booking()])
    expect(quarters).toHaveLength(1)
    expect(quarters[0].quarter).toBe('2025-Q3')
    expect(quarters[0].bookingCount).toBe(1)
  })

  it('derives 9% output VAT on the NET amount, not the gross renter total', () => {
    const { quarters } = aggregateClickAndBoatSummary([booking({ netAmountCents: 19700, revenueVatRate: 9 })])
    // 19700 / 1.09 = 18073 ex, 1627 VAT
    expect(quarters[0].revenueExCents).toBe(18073)
    expect(quarters[0].revenueVatCents).toBe(1627)
    expect(quarters[0].revenueExCents + quarters[0].revenueVatCents).toBe(19700)
  })

  it('ignores the gross renter total entirely for the VAT base', () => {
    const { quarters } = aggregateClickAndBoatSummary([booking({ grossAmountCents: 999999, netAmountCents: 19700 })])
    expect(quarters[0].revenueVatCents).toBe(1627)
  })

  it('keeps the gross amount as a separate reference figure', () => {
    const { totals } = aggregateClickAndBoatSummary([booking()])
    expect(totals.grossAmountCents).toBe(25000)
    expect(totals.netAmountCents).toBe(19700)
  })

  it('handles an outlier booking with a different gross/net amount', () => {
    const { quarters } = aggregateClickAndBoatSummary([
      booking({ grossAmountCents: 33000, netAmountCents: 26100 }),
    ])
    expect(quarters[0].revenueExCents).toBe(23945)
    expect(quarters[0].revenueVatCents).toBe(2155)
  })

  it('sums multiple bookings in the same quarter', () => {
    const { totals } = aggregateClickAndBoatSummary([booking(), booking()])
    expect(totals.bookingCount).toBe(2)
    expect(totals.grossAmountCents).toBe(50000)
    expect(totals.netAmountCents).toBe(39400)
    expect(totals.revenueVatCents).toBe(3254)
  })

  it('accepts a custom periodOf function for month-level bucketing (BTW dashboard per-maand view)', () => {
    const { quarters } = aggregateClickAndBoatSummary(
      [booking({ charterStartDate: '2025-09-13' }), booking({ charterStartDate: '2025-09-20' }), booking({ charterStartDate: '2025-10-01' })],
      date => date.slice(0, 7)
    )
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2025-09', '2025-10'])
    expect(quarters.find(q => q.quarter === '2025-09')?.bookingCount).toBe(2)
  })

  it('falls back to the default 9% rate when none is given', () => {
    const { quarters } = aggregateClickAndBoatSummary([booking({ revenueVatRate: null })])
    expect(quarters[0].revenueVatCents).toBe(1627)
  })

  it('skips bookings with no charter start date rather than crashing', () => {
    const { quarters, totals } = aggregateClickAndBoatSummary([booking({ charterStartDate: null })])
    expect(quarters).toEqual([])
    expect(totals.bookingCount).toBe(0)
  })
})
