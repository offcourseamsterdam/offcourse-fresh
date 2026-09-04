import { describe, it, expect } from 'vitest'
import { vatObligations } from './vat'
import type { QuarterBtwDashboard } from '@/lib/finance/btw-dashboard'

const TODAY = '2026-09-04'

const quarter = (o: Partial<QuarterBtwDashboard>): QuarterBtwDashboard => ({
  quarter: '2026-Q2', vat9OwedCents: 0, vat21OwedCents: 0, vat21DeductibleCents: 0,
  netIndicationCents: 0, bySource: {}, ...o,
})

describe('vatObligations', () => {
  it('proposes a closed quarter with the high/low split in the title', () => {
    const [o] = vatObligations([quarter({ quarter: '2026-Q2', vat9OwedCents: 400_000, vat21OwedCents: 80_000, netIndicationCents: 480_000 })], { today: TODAY })
    expect(o).toMatchObject({ key: 'vat:2026-Q2', amountCents: 480_000, isProvisional: false })
    expect(o.title).toContain('€4.000 laag')
    expect(o.title).toContain('€800 hoog')
    expect(o.title).not.toContain('loopt nog')
  })

  it('nets the deductible 21% against the total and shows it in the title', () => {
    const [o] = vatObligations([quarter({ vat21OwedCents: 100_000, vat21DeductibleCents: 30_000, netIndicationCents: 70_000 })], { today: TODAY })
    expect(o.amountCents).toBe(70_000)
    expect(o.title).toContain('terug te vragen')
  })

  it('labels the current quarter as still running', () => {
    const [o] = vatObligations([quarter({ quarter: '2026-Q3', vat21OwedCents: 100_000, netIndicationCents: 100_000 })], { today: TODAY })
    expect(o.isProvisional).toBe(true)
    expect(o.title).toContain('loopt nog')
  })

  it('does not propose a quarter with nothing owed or a net refund', () => {
    expect(vatObligations([quarter({ netIndicationCents: 0 })], { today: TODAY })).toEqual([])
    expect(vatObligations([quarter({ vat21DeductibleCents: 50_000, netIndicationCents: -20_000 })], { today: TODAY })).toEqual([])
  })

  it('falls due a month after the quarter, on month end, matching city tax\'s convention', () => {
    const [o] = vatObligations([quarter({ quarter: '2026-Q1', netIndicationCents: 10_000 })], { today: TODAY })
    expect(o.dueDate).toBe('2026-04-30')
  })

  it('lets the deadline be configured', () => {
    const [o] = vatObligations([quarter({ quarter: '2026-Q1', netIndicationCents: 10_000 })], { today: TODAY, dueMonthsAfterQuarter: 2 })
    expect(o.dueDate).toBe('2026-05-31')
  })
})
