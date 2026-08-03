import { describe, it, expect } from 'vitest'
import { aggregateBtwDashboard } from './btw-dashboard'

describe('aggregateBtwDashboard', () => {
  it('sums vat9/vat21 owed across sources for the same quarter', () => {
    const { quarters } = aggregateBtwDashboard({
      stripe: [{ quarter: '2026-Q2', vat9OwedCents: 1000, vat21OwedCents: 500 }],
      zettle: [{ quarter: '2026-Q2', vat21OwedCents: 200 }],
      boatlocal: [{ quarter: '2026-Q2', vat9OwedCents: 300, vat21DeductibleCents: 50 }],
    })
    expect(quarters).toHaveLength(1)
    expect(quarters[0].vat9OwedCents).toBe(1300)
    expect(quarters[0].vat21OwedCents).toBe(700)
    expect(quarters[0].vat21DeductibleCents).toBe(50)
  })

  it('computes the net indication as owed minus deductible', () => {
    const { quarters } = aggregateBtwDashboard({
      withlocals: [{ quarter: '2026-Q2', vat9OwedCents: 1000, vat21DeductibleCents: 300 }],
    })
    expect(quarters[0].netIndicationCents).toBe(700)
  })

  it('never lets a deductible-only source inflate the owed figures', () => {
    const { quarters } = aggregateBtwDashboard({
      boatlocal: [{ quarter: '2026-Q1', vat21DeductibleCents: 400 }],
    })
    expect(quarters[0].vat9OwedCents).toBe(0)
    expect(quarters[0].vat21OwedCents).toBe(0)
    expect(quarters[0].netIndicationCents).toBe(-400)
  })

  it('keeps a per-source breakdown for each quarter', () => {
    const { quarters } = aggregateBtwDashboard({
      stripe: [{ quarter: '2026-Q2', vat9OwedCents: 1000 }],
      zettle: [{ quarter: '2026-Q2', vat21OwedCents: 200 }],
    })
    expect(quarters[0].bySource.stripe.vat9OwedCents).toBe(1000)
    expect(quarters[0].bySource.zettle.vat21OwedCents).toBe(200)
    expect(quarters[0].bySource.zettle.vat9OwedCents).toBe(0)
  })

  it('sorts quarters newest first and sums totals across all quarters', () => {
    const { quarters, totals } = aggregateBtwDashboard({
      stripe: [
        { quarter: '2025-Q3', vat9OwedCents: 100 },
        { quarter: '2026-Q1', vat9OwedCents: 200 },
      ],
    })
    expect(quarters.map(q => q.quarter)).toEqual(['2026-Q1', '2025-Q3'])
    expect(totals.vat9OwedCents).toBe(300)
  })

  it('returns an empty result for no sources', () => {
    expect(aggregateBtwDashboard({})).toEqual({
      quarters: [],
      totals: { vat9OwedCents: 0, vat21OwedCents: 0, vat21DeductibleCents: 0, netIndicationCents: 0 },
    })
  })
})
