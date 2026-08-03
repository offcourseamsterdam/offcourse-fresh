import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  generateInvoicePdf,
  makeInvoiceNumber,
  buildInvoiceTotals,
  sanitizeForPdf,
  type InvoiceInput,
} from './generate-invoice-pdf'
import { CITY_TAX_CENTS_PER_GUEST } from './constants'

function baseInput(over: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    invoiceNumber: 'OC-TEST1234',
    invoiceDate: '27 June 2026',
    customerName: 'Tariq Janssen',
    customerEmail: 'tariq@example.com',
    listingTitle: 'Sunset Canal Cruise',
    bookingDate: '2026-06-30',
    guestCount: 4,
    baseAmountCents: 16500,
    extrasSelected: [],
    ...over,
  }
}

describe('buildInvoiceTotals — reconciliation', () => {
  it('net + vat always equals the inclusive total (per the VAT-inclusive model)', () => {
    const t = buildInvoiceTotals(baseInput({
      extrasSelected: [{ name: 'Cheese board', amount_cents: 2500 }],
    }))
    expect(t.totalNet + t.totalVat).toBe(t.totalIncl)
  })

  it('TOTAL DUE equals base + extras + cityTax − discount (what was charged)', () => {
    const guestCount = 4
    const base = 16500
    const extras = 2500
    const discount = 2000
    const cityTax = guestCount * CITY_TAX_CENTS_PER_GUEST
    const t = buildInvoiceTotals(baseInput({
      guestCount,
      baseAmountCents: base,
      extrasSelected: [{ name: 'Cheese board', amount_cents: extras }],
      discountAmountCents: discount,
    }))
    expect(t.totalIncl).toBe(base + extras + cityTax - discount)
  })

  it('renders a discount as a negative line at the cruise VAT rate', () => {
    const t = buildInvoiceTotals(baseInput({ discountAmountCents: 3000 }))
    const discountLine = t.lines.find(l => l.desc === 'Discount')
    expect(discountLine).toBeDefined()
    expect(discountLine!.amountIncl).toBe(-3000)
    expect(discountLine!.vatRate).toBe(9)
  })

  it('uses the supplied cityTaxCents when given, else derives from guestCount', () => {
    const derived = buildInvoiceTotals(baseInput({ guestCount: 3, cityTaxCents: null }))
    expect(derived.lines.find(l => l.desc.startsWith('Amsterdam city tax'))!.amountIncl)
      .toBe(3 * CITY_TAX_CENTS_PER_GUEST)

    const explicit = buildInvoiceTotals(baseInput({ guestCount: 3, cityTaxCents: 999 }))
    expect(explicit.lines.find(l => l.desc.startsWith('Amsterdam city tax'))!.amountIncl).toBe(999)
  })

  it('charges 9% VAT on the cruise and 21% on extras', () => {
    const t = buildInvoiceTotals(baseInput({
      baseAmountCents: 10900,                                   // 9% incl → 900 VAT
      cityTaxCents: 0,
      extrasSelected: [{ name: 'Wine', amount_cents: 1210 }],   // 21% incl → 210 VAT
    }))
    const cruise = t.lines.find(l => l.vatRate === 9)!
    const wine = t.lines.find(l => l.vatRate === 21)!
    expect(cruise.amountIncl).toBe(10900)
    expect(wine.amountIncl).toBe(1210)
    // vatByRate aggregates correctly
    expect(t.vatByRate.get(9)!.vat).toBe(900)
    expect(t.vatByRate.get(21)!.vat).toBe(210)
  })

  it('skips zero-amount lines', () => {
    const t = buildInvoiceTotals(baseInput({
      baseAmountCents: 0,
      cityTaxCents: 0,
      extrasSelected: [{ name: 'Free pretzel', amount_cents: 0 }],
    }))
    expect(t.lines).toHaveLength(0)
  })
})

describe('makeInvoiceNumber — stable & deterministic', () => {
  it('prefers the FareHarbor UUID and is stable across calls', () => {
    const a = makeInvoiceNumber('f77b627b-1111-2222-3333-444455556666', 'pi_abc')
    const b = makeInvoiceNumber('f77b627b-1111-2222-3333-444455556666', 'pi_xyz')
    expect(a).toBe('OC-F77B627B')
    expect(a).toBe(b) // PI changing must not change the number
  })

  it('falls back to the Stripe PI when no FH UUID', () => {
    expect(makeInvoiceNumber(null, 'pi_3AbCdEfGhIjK')).toBe('OC-3ABCDEFG')
  })

  it('never uses a non-deterministic fallback', () => {
    expect(makeInvoiceNumber(null, null)).toBe('OC-PENDING')
  })
})

describe('sanitizeForPdf — WinAnsi safety', () => {
  it('maps smart punctuation to ASCII equivalents', () => {
    expect(sanitizeForPdf('Tariq’s “boat” – trip')).toBe('Tariq\'s "boat" - trip')
  })

  it('strips characters outside WinAnsi (emoji, CJK)', () => {
    expect(sanitizeForPdf('Boat 🚤 中文')).toBe('Boat')
  })

  it('keeps Latin-1 accented characters (Curaçao)', () => {
    expect(sanitizeForPdf('Curaçao')).toBe('Curaçao')
  })

  it('handles null/undefined', () => {
    expect(sanitizeForPdf(null)).toBe('')
    expect(sanitizeForPdf(undefined)).toBe('')
  })
})

describe('generateInvoicePdf — never throws on hostile input', () => {
  it('produces a valid PDF for a normal booking', async () => {
    const bytes = await generateInvoicePdf(baseInput())
    expect(bytes).toBeInstanceOf(Uint8Array)
    // PDF magic header: %PDF
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
  })

  it('does not throw on emoji / CJK names (would crash WinAnsi fonts unguarded)', async () => {
    const bytes = await generateInvoicePdf(baseInput({
      customerName: '王小明 🚤',
      listingTitle: 'Zonsondergang 🌅 — Curaçao',
      extrasSelected: [{ name: 'Wijn 🍷', amount_cents: 1210 }],
    }))
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('does not throw on a null extra name', async () => {
    const bytes = await generateInvoicePdf(baseInput({
      // @ts-expect-error — deliberately malformed runtime data
      extrasSelected: [{ name: null, amount_cents: 500 }],
    }))
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('paginates instead of overflowing with many extras', async () => {
    const extras = Array.from({ length: 30 }, (_, i) => ({ name: `Extra item ${i}`, amount_cents: 500 }))
    const bytes = await generateInvoicePdf(baseInput({ extrasSelected: extras }))
    // 30 rows can't fit on one A4 page — the table must spill to a second page.
    const reloaded = await PDFDocument.load(bytes)
    expect(reloaded.getPageCount()).toBeGreaterThan(1)
  })
})
