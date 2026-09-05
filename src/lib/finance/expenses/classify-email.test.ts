import { describe, it, expect, vi } from 'vitest'
import { buildEmailPrompt, classifyFinanceEmail, extractLinks, parseEmailClassification, type FinanceEmailInput } from './classify-email'

vi.mock('@/lib/ai/usage', () => ({ recordAiUsage: vi.fn().mockResolvedValue(undefined) }))

const input = (over: Partial<FinanceEmailInput> = {}): FinanceEmailInput => ({
  fromEmail: 'noreply@bol.com', fromName: 'bol.com', subject: 'Je factuur staat klaar', bodyText: 'Your invoice for order #12345 is now available. Download it here: https://www.bol.com/invoices/INV-2026-12345.pdf',
  bodyHtml: null, hasPdfAttachment: false, hasImageAttachment: false, links: [], ...over,
})

describe('extractLinks', () => {
  it('finds http(s) URLs in text and hrefs in HTML, dedupes, strips trailing punctuation', () => {
    const links = extractLinks(
      'Download: https://www.bol.com/invoices/INV-1.pdf. Or https://www.bol.com/invoices/INV-1.pdf again (https://example.com/a).',
      '<a href="https://portal.example.com/login?next=%2Finvoice">Log in</a> <a href="mailto:x@y.z">mail</a>',
    )
    expect(links).toEqual(['https://www.bol.com/invoices/INV-1.pdf', 'https://example.com/a', 'https://portal.example.com/login?next=%2Finvoice'])
  })
  it('ignores non-http schemes and garbage', () => {
    expect(extractLinks('javascript:alert(1) mailto:a@b.c ftp://x/y see https://ok.example')).toEqual(['https://ok.example/'])
  })
  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => `https://e.com/${i}`).join(' ')
    expect(extractLinks(many)).toHaveLength(20)
  })
})

describe('buildEmailPrompt', () => {
  it('carries sender, subject, attachment flags, the links and the (truncated) body', () => {
    const p = buildEmailPrompt(input({ links: ['https://www.bol.com/invoices/INV-2026-12345.pdf'], hasPdfAttachment: true, bodyText: 'x'.repeat(7000) }))
    expect(p).toContain('bol.com <noreply@bol.com>')
    expect(p).toContain('Je factuur staat klaar')
    expect(p).toContain('PDF-bijlage aanwezig: ja')
    expect(p).toContain('https://www.bol.com/invoices/INV-2026-12345.pdf')
    expect(p).toContain('EUROCENTEN')
    expect(p.length).toBeLessThan(8000)
  })
})

describe('parseEmailClassification', () => {
  const GOOD = '{"kind":"invoice_notification","supplier_name":"bol.com","order_number":"12345","invoice_number":"INV-2026-12345","invoice_date":"2026-09-05","gross_cents":12100,"vat_cents":2100,"currency":"eur","payment_reference":null,"is_paid_confirmation":true,"confidence":0.92,"reason":"Factuurmelding met downloadlink."}'

  it('parses the PRD "your invoice is available" mail', () => {
    expect(parseEmailClassification(GOOD)).toEqual({
      kind: 'invoice_notification', supplierName: 'bol.com', orderNumber: '12345', invoiceNumber: 'INV-2026-12345', invoiceDate: '2026-09-05',
      grossCents: 12100, vatCents: 2100, currency: 'EUR', paymentReference: null, isPaidConfirmation: true, confidence: 0.92, reason: 'Factuurmelding met downloadlink.',
    })
  })
  it('tolerates prose around the JSON', () => {
    expect(parseEmailClassification(`Hier is het antwoord:\n${GOOD}\nSucces!`)?.kind).toBe('invoice_notification')
  })
  it('rejects an unknown kind, a non-JSON answer, and garbage dates/amounts', () => {
    expect(parseEmailClassification(GOOD.replace('invoice_notification', 'bill'))).toBeNull()
    expect(parseEmailClassification('geen idee')).toBeNull()
    const r = parseEmailClassification(GOOD.replace('"2026-09-05"', '"5 september"').replace('12100', '"121,00"').replace('0.92', '7'))!
    expect(r.invoiceDate).toBeNull()
    expect(r.grossCents).toBeNull()
    expect(r.confidence).toBe(1)
  })
  it('is_paid_confirmation is only true when literally true', () => {
    expect(parseEmailClassification(GOOD.replace('"is_paid_confirmation":true', '"is_paid_confirmation":"yes"'))!.isPaidConfirmation).toBe(false)
  })
})

describe('classifyFinanceEmail', () => {
  it('uses the injected model and returns the parsed classification', async () => {
    const callModel = vi.fn().mockResolvedValue('{"kind":"order_confirmation","order_number":"12345","confidence":0.9,"reason":"ok"}')
    const r = await classifyFinanceEmail(input(), { callModel })
    expect(r?.kind).toBe('order_confirmation')
    expect(r?.orderNumber).toBe('12345')
    expect(callModel.mock.calls[0][0]).toContain('Je factuur staat klaar')
  })
  it('an unusable answer is null, never a default classification', async () => {
    expect(await classifyFinanceEmail(input(), { callModel: async () => 'sorry' })).toBeNull()
  })
})
