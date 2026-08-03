import { describe, it, expect } from 'vitest'
import { aggregateWithlocalsSummary, type WithlocalsBookingInput } from './withlocals-summary'

// Booking shaped like the real invoice #0718534: €320.00 tour price, 32%
// commission (€102.40 incl its own 21% VAT), €217.60 net payable to host.
// Beer's accountant confirmed 9% goes over the €320.00 tour price — NOT the
// €217.60 net payout (an earlier version of this file had that backwards).
function booking(overrides: Partial<WithlocalsBookingInput> = {}): WithlocalsBookingInput {
  return {
    tripAt: '2026-06-21T15:00',
    tourName: 'Secret Amsterdam Boat Tour: Off the Beaten Canals',
    tourPriceCents: 32000,
    revenueVatRate: 9,
    serviceFeeExCents: 8463,
    serviceFeeVatCents: 1777,
    netPayoutCents: 21760,
    ...overrides,
  }
}

describe('aggregateWithlocalsSummary', () => {
  it('buckets a booking by its trip month', () => {
    const { months } = aggregateWithlocalsSummary([booking()])
    expect(months).toHaveLength(1)
    expect(months[0].month).toBe('2026-06')
    expect(months[0].bookingCount).toBe(1)
  })

  it('derives 9% output VAT on the gross tour price, not the net payout', () => {
    const { months } = aggregateWithlocalsSummary([booking({ tourPriceCents: 32000, revenueVatRate: 9 })])
    // 32000 / 1.09 = 29358 ex, 2642 VAT — confirmed by Beer's accountant against real invoice #0718534
    expect(months[0].revenueExCents).toBe(29358)
    expect(months[0].revenueVatCents).toBe(2642)
    expect(months[0].revenueExCents + months[0].revenueVatCents).toBe(32000)
  })

  it('ignores the net payout entirely for the VAT base', () => {
    const { months } = aggregateWithlocalsSummary([booking({ tourPriceCents: 32000, netPayoutCents: 1 })])
    expect(months[0].revenueInclCents).toBe(32000)
  })

  it('keeps the commission and its 21% deductible VAT', () => {
    const { totals } = aggregateWithlocalsSummary([booking()])
    expect(totals.commissionExCents).toBe(8463)
    expect(totals.commissionVatCents).toBe(1777)
    expect(totals.netPayoutCents).toBe(21760)
  })

  it('rolls up a per-tour breakdown within the month', () => {
    const { months } = aggregateWithlocalsSummary([
      booking({ tripAt: '2026-06-01T12:00', tourName: 'Secret Amsterdam Boat Tour', tourPriceCents: 32000 }),
      booking({ tripAt: '2026-06-15T12:00', tourName: 'Secret Amsterdam Boat Tour', tourPriceCents: 32000 }),
      booking({ tripAt: '2026-06-20T12:00', tourName: 'Sunset Canal Cruise', tourPriceCents: 24750 }),
    ])
    const june = months[0]
    expect(june.tours).toHaveLength(2)
    // sorted by revenue desc: 2×320.00 = 640.00 beats 247.50
    expect(june.tours[0]).toEqual({
      tourName: 'Secret Amsterdam Boat Tour',
      bookingCount: 2,
      revenueInclCents: 64000,
      revenueVatCents: 5284,
    })
    expect(june.tours[1].tourName).toBe('Sunset Canal Cruise')
  })

  it('separates tours of the same name across different months', () => {
    const { months } = aggregateWithlocalsSummary([
      booking({ tripAt: '2026-06-10T12:00', tourName: 'Boat Tour' }),
      booking({ tripAt: '2026-05-10T12:00', tourName: 'Boat Tour' }),
    ])
    expect(months.map(m => m.month)).toEqual(['2026-06', '2026-05']) // newest first
    expect(months[0].tours[0].bookingCount).toBe(1)
    expect(months[1].tours[0].bookingCount).toBe(1)
  })

  it('sums revenue (gross tour price) and net payout separately across a month', () => {
    const { totals } = aggregateWithlocalsSummary([
      booking({ tourPriceCents: 32000, netPayoutCents: 21760 }),
      booking({ tourPriceCents: 24750, netPayoutCents: 16830, serviceFeeExCents: 6545, serviceFeeVatCents: 1375 }),
    ])
    expect(totals.revenueInclCents).toBe(56750)
    expect(totals.netPayoutCents).toBe(38590)
    expect(totals.commissionVatCents).toBe(3152)
  })

  it('falls back to a placeholder tour name and default 9% rate', () => {
    const { months } = aggregateWithlocalsSummary([booking({ tourName: null, revenueVatRate: null })])
    expect(months[0].tours[0].tourName).toBe('Onbekende tour')
    expect(months[0].revenueVatCents).toBe(2642) // still 9%, over the gross tour price
  })

  it('skips bookings with no trip date rather than crashing', () => {
    const { months, totals } = aggregateWithlocalsSummary([booking({ tripAt: null })])
    expect(months).toEqual([])
    expect(totals.bookingCount).toBe(0)
  })
})
