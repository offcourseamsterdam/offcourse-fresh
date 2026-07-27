import { describe, it, expect } from 'vitest'
import { aggregateGetMyBoatSummary, type GetMyBoatBookingSummaryInput } from './getmyboat-summary'

// Booking shaped like the real payout example: booking 5680543, €342.00 net
// payout. Beer confirmed 9% goes over this net amount, not the €400.00
// "Base Cost" from the booking confirmation email — same convention as
// Click & Boat/GetYourGuide/Viator (Withlocals is the one exception).
function booking(overrides: Partial<GetMyBoatBookingSummaryInput> = {}): GetMyBoatBookingSummaryInput {
  return {
    charterDate: '2026-05-23',
    netAmountCents: 34200,
    revenueVatRate: 9,
    ...overrides,
  }
}

describe('aggregateGetMyBoatSummary', () => {
  it('buckets a booking by its charter quarter', () => {
    const { quarters } = aggregateGetMyBoatSummary([booking()])
    expect(quarters).toHaveLength(1)
    expect(quarters[0].quarter).toBe('2026-Q2')
    expect(quarters[0].bookingCount).toBe(1)
  })

  it('derives 9% output VAT on the net payout, not the gross Base Cost from the confirmation email', () => {
    const { quarters } = aggregateGetMyBoatSummary([booking({ netAmountCents: 34200, revenueVatRate: 9 })])
    // 34200 / 1.09 = 31376 ex, 2824 VAT
    expect(quarters[0].revenueExCents).toBe(31376)
    expect(quarters[0].revenueVatCents).toBe(2824)
    expect(quarters[0].revenueExCents + quarters[0].revenueVatCents).toBe(34200)
  })

  it('sums multiple bookings in the same quarter (real payout: 2 bookings, €641.25 total)', () => {
    const { quarters, totals } = aggregateGetMyBoatSummary([
      booking({ netAmountCents: 34200 }),
      booking({ netAmountCents: 29925 }),
    ])
    expect(quarters[0].bookingCount).toBe(2)
    expect(quarters[0].netAmountCents).toBe(64125)
    expect(quarters[0].revenueExCents).toBe(58830)
    expect(quarters[0].revenueVatCents).toBe(5295)
    expect(totals.netAmountCents).toBe(64125)
  })

  it('accepts a custom periodOf function for month-level bucketing (BTW dashboard per-maand view)', () => {
    const { quarters } = aggregateGetMyBoatSummary(
      [booking({ charterDate: '2026-05-22' }), booking({ charterDate: '2026-05-23' }), booking({ charterDate: '2026-06-01' })],
      date => date.slice(0, 7)
    )
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2026-05', '2026-06'])
    expect(quarters.find(q => q.quarter === '2026-05')?.bookingCount).toBe(2)
  })

  it('falls back to the default 9% rate when none is given', () => {
    const { quarters } = aggregateGetMyBoatSummary([booking({ revenueVatRate: null })])
    expect(quarters[0].revenueVatCents).toBe(2824)
  })

  it('skips bookings with no charter date rather than crashing', () => {
    const { quarters, totals } = aggregateGetMyBoatSummary([booking({ charterDate: null })])
    expect(quarters).toEqual([])
    expect(totals.bookingCount).toBe(0)
  })

  it('returns all-zero totals for an empty booking list', () => {
    const { quarters, totals } = aggregateGetMyBoatSummary([])
    expect(quarters).toEqual([])
    expect(totals).toEqual({ bookingCount: 0, netAmountCents: 0, revenueExCents: 0, revenueVatCents: 0 })
  })
})
