import { describe, it, expect } from 'vitest'
import { aggregateZettleSummary, type ZettleMonthInput } from './zettle-sales'

// A month shaped like the real June 2025 figures read off Zettle's
// Verkoopdetails page (see session notes). Amounts in integer cents.
function month(overrides: Partial<ZettleMonthInput> = {}): ZettleMonthInput {
  return {
    month: '2025-06-01',
    totalInclVatCents: 24650,
    totalExclVatCents: 22487,
    saleCount: 4,
    vat9ExclCents: 21330,
    vat9VatCents: 1920,
    vat9InclCents: 23250,
    vat21ExclCents: 1157,
    vat21VatCents: 243,
    vat21InclCents: 1400,
    totalVatCents: 2163,
    cardGrossCents: 12500,
    cardSurchargeCents: 244,
    cardNetCents: 12256,
    cashZettleCents: 12150,
    cashCountedCents: null,
    ...overrides,
  }
}

describe('aggregateZettleSummary', () => {
  it('buckets a month by the quarter its sales happened in', () => {
    const { quarters } = aggregateZettleSummary([month()])
    expect(quarters).toHaveLength(1)
    expect(quarters[0].quarter).toBe('2025-Q2')
    expect(quarters[0].monthCount).toBe(1)
    expect(quarters[0].totalInclVatCents).toBe(24650)
    expect(quarters[0].totalVatCents).toBe(2163)
    expect(quarters[0].cardNetCents).toBe(12256)
    expect(quarters[0].cashZettleCents).toBe(12150)
  })

  it('sums the VAT split across months in a quarter', () => {
    const { totals } = aggregateZettleSummary([
      month({ month: '2025-04-01', vat9VatCents: 1000, vat21VatCents: 100 }),
      month({ month: '2025-05-01', vat9VatCents: 2000, vat21VatCents: 200 }),
    ])
    expect(totals.monthCount).toBe(2)
    expect(totals.vat9VatCents).toBe(3000)
    expect(totals.vat21VatCents).toBe(300)
  })

  it('leaves a month with no manual cash count out of the reconciliation, and flags it', () => {
    const { quarters } = aggregateZettleSummary([month({ cashCountedCents: null })])
    expect(quarters[0].cashUncountedMonths).toBe(1)
    expect(quarters[0].cashCountedCents).toBe(0)
    expect(quarters[0].cashDiffCents).toBe(0)
  })

  it('computes counted − Zettle as the discrepancy when a count is present', () => {
    // Beer counted €125,00 physical cash; Zettle reported €121,50 → +€3,50 over.
    const { quarters } = aggregateZettleSummary([
      month({ cashZettleCents: 12150, cashCountedCents: 12500 }),
    ])
    expect(quarters[0].cashUncountedMonths).toBe(0)
    expect(quarters[0].cashCountedCents).toBe(12500)
    expect(quarters[0].cashDiffCents).toBe(350)
  })

  it('handles a negative discrepancy (counted less than Zettle reported)', () => {
    const { quarters } = aggregateZettleSummary([
      month({ cashZettleCents: 12150, cashCountedCents: 12000 }),
    ])
    expect(quarters[0].cashDiffCents).toBe(-150)
  })

  it('mixes counted and uncounted months in the same quarter correctly', () => {
    const { totals } = aggregateZettleSummary([
      month({ month: '2025-04-01', cashZettleCents: 10000, cashCountedCents: 10050 }),
      month({ month: '2025-05-01', cashZettleCents: 20000, cashCountedCents: null }),
    ])
    expect(totals.monthCount).toBe(2)
    expect(totals.cashUncountedMonths).toBe(1)
    expect(totals.cashDiffCents).toBe(50) // only the counted month contributes
    expect(totals.cashZettleCents).toBe(30000) // both months' Zettle cash still summed
  })

  it('sorts quarters newest-first', () => {
    const { quarters } = aggregateZettleSummary([
      month({ month: '2025-06-01' }),
      month({ month: '2025-09-01' }),
      month({ month: '2026-01-01' }),
    ])
    expect(quarters.map(q => q.quarter)).toEqual(['2026-Q1', '2025-Q3', '2025-Q2'])
  })

  it('treats null money fields as zero rather than NaN', () => {
    const { totals } = aggregateZettleSummary([
      month({ totalInclVatCents: null, totalVatCents: null, cardNetCents: null, cashZettleCents: null }),
    ])
    expect(totals.totalInclVatCents).toBe(0)
    expect(totals.totalVatCents).toBe(0)
    expect(totals.cardNetCents).toBe(0)
    expect(totals.cashZettleCents).toBe(0)
  })

  it('sums the card surcharge (toeslag) across months so it shows as a cost', () => {
    const { quarters, totals } = aggregateZettleSummary([
      month({ month: '2025-06-01', cardGrossCents: 12500, cardSurchargeCents: 244, cardNetCents: 12256 }),
      month({ month: '2025-05-01', cardGrossCents: 10000, cardSurchargeCents: 195, cardNetCents: 9805 }),
    ])
    expect(quarters[0].cardGrossCents).toBe(22500)
    expect(quarters[0].cardSurchargeCents).toBe(439)
    expect(quarters[0].cardNetCents).toBe(22061)
    // gross − surcharge must equal net, so the toeslag is fully accounted for
    expect(totals.cardGrossCents - totals.cardSurchargeCents).toBe(totals.cardNetCents)
  })

  it('returns empty when given no months', () => {
    expect(aggregateZettleSummary([])).toEqual({
      quarters: [],
      totals: {
        monthCount: 0, totalInclVatCents: 0, totalVatCents: 0, vat9VatCents: 0,
        vat21VatCents: 0, cardGrossCents: 0, cardSurchargeCents: 0, cardNetCents: 0,
        cashZettleCents: 0, cashCountedCents: 0, cashDiffCents: 0, cashUncountedMonths: 0,
      },
    })
  })
})
