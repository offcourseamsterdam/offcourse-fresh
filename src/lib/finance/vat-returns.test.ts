import { describe, expect, it } from 'vitest'
import { vatReturnObligationNotes, vatReturnObligationTitle } from './vat-returns'

describe('vatReturnObligationTitle', () => {
  it('reads as a refund when net is negative', () => {
    expect(vatReturnObligationTitle({ quarter: '2026-Q1', filedDate: '2026-04-30', netCents: -3485500 })).toBe(
      'BTW 2026-Q1 — aangifte binnen: €34.855 terugontvangen',
    )
  })

  it('reads as owed when net is positive', () => {
    expect(vatReturnObligationTitle({ quarter: '2026-Q3', filedDate: '2026-10-31', netCents: 150000 })).toBe(
      'BTW 2026-Q3 — aangifte binnen: €1.500 verschuldigd',
    )
  })

  it('reads as nihil when net is exactly zero', () => {
    expect(vatReturnObligationTitle({ quarter: '2026-Q2', filedDate: '2026-07-31', netCents: 0 })).toBe(
      'BTW 2026-Q2 — aangifte binnen: per saldo niets verschuldigd',
    )
  })
})

describe('vatReturnObligationNotes', () => {
  it('includes the filed date and breakdown', () => {
    const notes = vatReturnObligationNotes({
      quarter: '2026-Q1',
      filedDate: '2026-04-30',
      netCents: -3485500,
      vat9OwedCents: 220000,
      vat21OwedCents: 0,
      voorbelastingCents: 3705500,
    })
    expect(notes).toContain('Werkelijke aangifte, verzonden 2026-04-30.')
    expect(notes).toContain('€2.200 verschuldigd laag (9%)')
    expect(notes).toContain('€37.055 voorbelasting')
  })

  it('flags a material gap against the prior computed indication', () => {
    const notes = vatReturnObligationNotes(
      { quarter: '2026-Q1', filedDate: '2026-04-30', netCents: -3485500 },
      { priorIndicationCents: 180423 },
    )
    expect(notes).toContain('eerder automatisch berekende indicatie was €1.804 verschuldigd')
    expect(notes).toContain('wijkt af van de werkelijke aangifte')
  })

  it('does not flag a negligible gap', () => {
    const notes = vatReturnObligationNotes({ quarter: '2026-Q2', filedDate: '2026-07-31', netCents: -1500 }, { priorIndicationCents: -1450 })
    expect(notes).not.toContain('wijkt af')
  })

  it('appends any extra notes typed by hand', () => {
    const notes = vatReturnObligationNotes({ quarter: '2026-Q2', filedDate: '2026-07-31', netCents: 0 }, { extraNotes: 'Doorgestuurd door New Financials.' })
    expect(notes).toContain('Doorgestuurd door New Financials.')
  })
})
