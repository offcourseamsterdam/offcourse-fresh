import { describe, it, expect, vi } from 'vitest'
import { extractDocumentFields, parseDocumentExtraction } from './extract-document'

vi.mock('@/lib/ai/usage', () => ({ recordAiUsage: vi.fn().mockResolvedValue(undefined) }))

const BOL = {
  document_kind: 'invoice',
  supplier_name: 'bol.com b.v.',
  order_number: '12345',
  invoice_number: 'INV-2026-12345',
  invoice_date: '2026-09-05',
  gross_cents: 12100,
  net_cents: 10000,
  vat_cents: 2100,
  vat_rate_pct: 21,
  currency: 'eur',
  iban: null,
  payment_reference: null,
  confidence: { document_kind: 1, supplier_name: 1, order_number: 1, invoice_number: 1, invoice_date: 1, gross_cents: 1, net_cents: 0.9, vat_cents: 1, vat_rate_pct: 1, currency: 1, iban: 0, payment_reference: 0 },
}

describe('parseDocumentExtraction', () => {
  it('maps the PRD bol.com invoice, upper-casing the currency', () => {
    const r = parseDocumentExtraction(BOL)!
    expect(r.fields).toEqual({
      documentKind: 'invoice', supplierName: 'bol.com b.v.', orderNumber: '12345', invoiceNumber: 'INV-2026-12345', invoiceDate: '2026-09-05',
      grossCents: 12100, netCents: 10000, vatCents: 2100, vatRatePct: 21, currency: 'EUR', iban: null, paymentReference: null,
    })
    expect(r.confidence.netCents).toBe(0.9)
    expect(r.confidence.iban).toBe(0)
  })

  it('a missing field is null with confidence 0, never guessed', () => {
    const raw = { ...BOL } as Record<string, unknown>
    delete raw.vat_cents
    const r = parseDocumentExtraction(raw)!
    expect(r.fields.vatCents).toBeNull()
    expect(r.confidence.vatCents).toBe(0)
  })

  it('an explicit 0 VAT (reverse charge) survives as 0, not null', () => {
    const r = parseDocumentExtraction({ ...BOL, vat_cents: 0, vat_rate_pct: 0 })!
    expect(r.fields.vatCents).toBe(0)
    expect(r.fields.vatRatePct).toBe(0)
  })

  it('numbers given as strings or negatives are treated as not found', () => {
    const r = parseDocumentExtraction({ ...BOL, gross_cents: '121,00', vat_cents: -5 })!
    expect(r.fields.grossCents).toBeNull()
    expect(r.fields.vatCents).toBeNull()
  })

  it('an unknown document_kind becomes null; the IBAN is normalised', () => {
    const r = parseDocumentExtraction({ ...BOL, document_kind: 'bill', iban: 'nl91 abna 0417 1643 00' })!
    expect(r.fields.documentKind).toBeNull()
    expect(r.fields.iban).toBe('NL91ABNA0417164300')
  })

  it('confidence is clamped and absent confidence is 0', () => {
    const r = parseDocumentExtraction({ ...BOL, confidence: { gross_cents: 7, supplier_name: -1 } })!
    expect(r.confidence.grossCents).toBe(1)
    expect(r.confidence.supplierName).toBe(0)
    expect(r.confidence.invoiceNumber).toBe(0)
  })

  it('garbage in → null out', () => {
    expect(parseDocumentExtraction(null)).toBeNull()
  })
})

describe('extractDocumentFields', () => {
  const gemini = (text: string) => ({ getGenerativeModel: () => ({ generateContent: async () => ({ response: { text: () => text, usageMetadata: {} } }) }) }) as never

  it('sends the sniffed mime type, not a caller-supplied label, and parses the reply', async () => {
    const generateContent = vi.fn(async (_parts: unknown[]) => ({ response: { text: () => JSON.stringify(BOL), usageMetadata: {} } }))
    const g = { getGenerativeModel: () => ({ generateContent }) } as never
    const r = await extractDocumentFields('AAAA', 'image/jpeg', { gemini: g })
    expect(r.fields.invoiceNumber).toBe('INV-2026-12345')
    const parts = generateContent.mock.calls[0]![0] as Array<Record<string, unknown>>
    expect(parts[1]).toEqual({ inlineData: { data: 'AAAA', mimeType: 'image/jpeg' } })
  })

  it('throws on an unparseable reply instead of returning half a record', async () => {
    await expect(extractDocumentFields('AAAA', 'application/pdf', { gemini: gemini('sorry, I cannot read this') })).rejects.toThrow(/unparseable/)
  })
})
