import { describe, it, expect } from 'vitest'
import { impliedRatePct, resolveVat, vatFromGrossAndRate } from './vat'

describe('vatFromGrossAndRate', () => {
  it('€121 at 21% is €21 (the PRD example)', () => {
    expect(vatFromGrossAndRate(12100, 21)).toBe(2100)
  })
  it('€24,20 at 21% is €4,20 (the ice-cream receipt)', () => {
    expect(vatFromGrossAndRate(2420, 21)).toBe(420)
  })
  it('9% (the low Dutch rate) and 0% (reverse charge / exempt)', () => {
    expect(vatFromGrossAndRate(10900, 9)).toBe(900)
    expect(vatFromGrossAndRate(10000, 0)).toBe(0)
  })
})

describe('impliedRatePct', () => {
  it('reads 21% back out of €21 on €121', () => {
    expect(impliedRatePct(12100, 2100)).toBe(21)
  })
  it('is null when it cannot be computed', () => {
    expect(impliedRatePct(null, 2100)).toBeNull()
    expect(impliedRatePct(2100, 2100)).toBeNull()
  })
})

describe('resolveVat — trust order', () => {
  it('nothing known → all null, no conflict', () => {
    expect(resolveVat(12100, [])).toEqual({ vatCents: null, netCents: null, ratePct: null, source: null, conflict: null })
  })

  it('the invoice outranks Revolut when they agree', () => {
    const r = resolveVat(12100, [{ source: 'revolut', vatCents: 2100, ratePct: 21 }, { source: 'invoice', vatCents: 2100 }])
    expect(r).toMatchObject({ vatCents: 2100, netCents: 10000, source: 'invoice', conflict: null })
    expect(r.ratePct).toBe(21) // implied, since the invoice gave none
  })

  it('the PRD conflict: invoice €21 vs Revolut €20 → invoice wins AND the conflict is recorded', () => {
    const r = resolveVat(12100, [{ source: 'invoice', vatCents: 2100 }, { source: 'revolut', vatCents: 2000, ratePct: 20 }])
    expect(r.source).toBe('invoice')
    expect(r.vatCents).toBe(2100)
    expect(r.conflict).toEqual({ invoice: 2100, revolut: 2000 })
  })

  it('a difference within €0,02 is rounding, not a conflict', () => {
    const r = resolveVat(12100, [{ source: 'invoice', vatCents: 2100 }, { source: 'receipt', vatCents: 2101 }])
    expect(r.conflict).toBeNull()
  })

  it('a manual figure ends the argument — no conflict even when sources disagree', () => {
    const r = resolveVat(12100, [{ source: 'invoice', vatCents: 2100 }, { source: 'revolut', vatCents: 2000 }, { source: 'manual', vatCents: 2100 }])
    expect(r.source).toBe('manual')
    expect(r.conflict).toBeNull()
  })

  it('a 0% answer (reverse charge) is a real answer, not "unknown"', () => {
    const r = resolveVat(10000, [{ source: 'invoice', vatCents: 0, ratePct: 0 }])
    expect(r).toMatchObject({ vatCents: 0, netCents: 10000, ratePct: 0, source: 'invoice', conflict: null })
  })

  it('an AI guess is used only when nothing better exists', () => {
    expect(resolveVat(12100, [{ source: 'ai', vatCents: 2100 }]).source).toBe('ai')
    expect(resolveVat(12100, [{ source: 'ai', vatCents: 2100 }, { source: 'receipt', vatCents: 2100 }]).source).toBe('receipt')
  })

  it('unknown gross still yields the VAT figure, just no net', () => {
    expect(resolveVat(null, [{ source: 'revolut', vatCents: 2100, ratePct: 21 }])).toMatchObject({ vatCents: 2100, netCents: null, ratePct: 21 })
  })

  it('negative or non-integer candidates are ignored, never trusted', () => {
    expect(resolveVat(12100, [{ source: 'invoice', vatCents: -5 }, { source: 'ai', vatCents: 21.5 }]).source).toBeNull()
  })
})
