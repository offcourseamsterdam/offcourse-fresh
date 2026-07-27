import { describe, it, expect } from 'vitest'
import { aggregateVatStripeSummary, type StripeBookingRow } from './vat-stripe-summary'

function row(overrides: Partial<StripeBookingRow>): StripeBookingRow {
  return {
    created_at: '2026-05-15T10:00:00Z',
    stripe_amount: 0,
    base_vat_amount_cents: 0,
    extras_vat_amount_cents: 0,
    total_vat_amount_cents: 0,
    stripe_fee_cents: null,
    ...overrides,
  }
}

describe('aggregateVatStripeSummary', () => {
  it('sums gross, VAT (9%/21%) and fee into a single quarter bucket', () => {
    const { quarters, totals } = aggregateVatStripeSummary([
      row({ stripe_amount: 13000, base_vat_amount_cents: 1074, extras_vat_amount_cents: 0, total_vat_amount_cents: 1074, stripe_fee_cents: 187 }),
      row({ stripe_amount: 5000, base_vat_amount_cents: 0, extras_vat_amount_cents: 868, total_vat_amount_cents: 868, stripe_fee_cents: 95 }),
    ])

    expect(quarters).toHaveLength(1)
    expect(quarters[0]).toEqual({
      quarter: '2026-Q2',
      bookingCount: 2,
      grossCents: 18000,
      vat9Cents: 1074,
      vat21Cents: 868,
      totalVatCents: 1942,
      stripeFeeCents: 282,
      netCents: 18000 - 282,
      missingFeeCount: 0,
    })
    expect(totals).toEqual({
      bookingCount: 2,
      grossCents: 18000,
      vat9Cents: 1074,
      vat21Cents: 868,
      totalVatCents: 1942,
      stripeFeeCents: 282,
      netCents: 18000 - 282,
      missingFeeCount: 0,
    })
  })

  it('buckets by the quarter payment happened (created_at), not the cruise date', () => {
    const { quarters } = aggregateVatStripeSummary([
      row({ created_at: '2026-01-10T00:00:00Z', stripe_amount: 100 }),
      row({ created_at: '2026-03-31T23:59:59Z', stripe_amount: 100 }),
      row({ created_at: '2026-04-01T00:00:00Z', stripe_amount: 100 }),
    ])

    const q1 = quarters.find(q => q.quarter === '2026-Q1')
    const q2 = quarters.find(q => q.quarter === '2026-Q2')
    expect(q1?.bookingCount).toBe(2)
    expect(q2?.bookingCount).toBe(1)
  })

  it('counts a booking with no fee yet as missingFeeCount, not a zero fee', () => {
    const { quarters } = aggregateVatStripeSummary([
      row({ stripe_amount: 10000, stripe_fee_cents: null }),
      row({ stripe_amount: 10000, stripe_fee_cents: 150 }),
    ])

    expect(quarters[0].missingFeeCount).toBe(1)
    expect(quarters[0].stripeFeeCents).toBe(150) // the unresolved one contributes 0, not skipped from the sum entirely
    expect(quarters[0].netCents).toBe(20000 - 150)
  })

  it('sorts quarters newest first', () => {
    const { quarters } = aggregateVatStripeSummary([
      row({ created_at: '2025-01-01T00:00:00Z' }),
      row({ created_at: '2026-07-01T00:00:00Z' }),
      row({ created_at: '2025-12-01T00:00:00Z' }),
    ])

    expect(quarters.map(q => q.quarter)).toEqual(['2026-Q3', '2025-Q4', '2025-Q1'])
  })

  it('skips rows with no created_at (should not happen, but never crash the report)', () => {
    const { quarters, totals } = aggregateVatStripeSummary([
      row({ created_at: null }),
    ])
    expect(quarters).toHaveLength(0)
    expect(totals.bookingCount).toBe(0)
  })

  it('returns all-zero totals for an empty booking list', () => {
    const { quarters, totals } = aggregateVatStripeSummary([])
    expect(quarters).toEqual([])
    expect(totals).toEqual({
      bookingCount: 0, grossCents: 0, vat9Cents: 0, vat21Cents: 0,
      totalVatCents: 0, stripeFeeCents: 0, netCents: 0, missingFeeCount: 0,
    })
  })

  it('accepts a custom periodOf function for month-level bucketing (BTW dashboard per-maand view)', () => {
    const { quarters } = aggregateVatStripeSummary(
      [
        row({ created_at: '2026-07-08T10:00:00Z', stripe_amount: 100 }),
        row({ created_at: '2026-07-20T10:00:00Z', stripe_amount: 100 }),
        row({ created_at: '2026-08-01T10:00:00Z', stripe_amount: 100 }),
      ],
      date => date.slice(0, 7)
    )
    expect(quarters.map(q => q.quarter).sort()).toEqual(['2026-07', '2026-08'])
    expect(quarters.find(q => q.quarter === '2026-07')?.bookingCount).toBe(2)
  })

  it('totals across multiple quarters match the sum of each quarter', () => {
    const { quarters, totals } = aggregateVatStripeSummary([
      row({ created_at: '2026-01-05T00:00:00Z', stripe_amount: 10000, total_vat_amount_cents: 900, stripe_fee_cents: 100 }),
      row({ created_at: '2026-04-05T00:00:00Z', stripe_amount: 20000, total_vat_amount_cents: 1800, stripe_fee_cents: 200 }),
    ])

    expect(totals.grossCents).toBe(quarters.reduce((s, q) => s + q.grossCents, 0))
    expect(totals.totalVatCents).toBe(900 + 1800)
    expect(totals.stripeFeeCents).toBe(100 + 200)
    expect(totals.netCents).toBe((10000 - 100) + (20000 - 200))
  })
})
