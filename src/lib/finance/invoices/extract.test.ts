import { describe, it, expect, vi } from 'vitest'
import { extractInvoiceFields, parseExtractionResponse } from './extract'

// recordAiUsage() builds a real Supabase client and issues real HTTP inserts;
// unmocked, every test below made a network call against the placeholder URL.
vi.mock('@/lib/ai/usage', () => ({ recordAiUsage: vi.fn().mockResolvedValue(undefined) }))

function mockGemini(response: string) {
  return {
    getGenerativeModel: vi.fn(() => ({
      generateContent: vi.fn(async () => ({
        response: { text: () => response, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } },
      })),
    })),
  } as never
}

function mockGeminiSequence(responses: Array<string | Error>) {
  let call = 0
  return {
    getGenerativeModel: vi.fn(() => ({
      generateContent: vi.fn(async () => {
        const next = responses[call++]
        if (next instanceof Error) throw next
        return { response: { text: () => next, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } } }
      }),
    })),
  } as never
}

const FULL_RESPONSE = JSON.stringify({
  invoice_number: 'INV-042',
  invoice_date: '2026-09-01',
  supplier_name: 'Mare de Vries',
  iban: 'NL91ABNA0417164300',
  tour_date: '2026-08-30',
  booking_ref: 'BR-123',
  hours: 4,
  rate_cents: 2000,
  amount_cents: 8000,
  vat_cents: 0,
  confidence: {
    invoice_number: 1,
    invoice_date: 1,
    supplier_name: 0.9,
    iban: 1,
    tour_date: 0.8,
    booking_ref: 0.5,
    hours: 1,
    rate_cents: 1,
    amount_cents: 1,
    vat_cents: 1,
  },
})

describe('parseExtractionResponse', () => {
  it('maps every wire field to its camelCase equivalent', () => {
    const result = parseExtractionResponse(JSON.parse(FULL_RESPONSE))
    expect(result?.fields).toEqual({
      invoiceNumber: 'INV-042',
      invoiceDate: '2026-09-01',
      supplierName: 'Mare de Vries',
      iban: 'NL91ABNA0417164300',
      tourDate: '2026-08-30',
      bookingRef: 'BR-123',
      hours: 4,
      rateCents: 2000,
      amountCents: 8000,
      vatCents: 0,
    })
  })

  it('null raw input → null result', () => {
    expect(parseExtractionResponse(null)).toBeNull()
  })

  it('a field missing from the response comes back null with confidence 0, never guessed', () => {
    const raw = JSON.parse(FULL_RESPONSE)
    delete raw.iban
    delete raw.confidence.iban
    const result = parseExtractionResponse(raw)
    expect(result?.fields.iban).toBeNull()
    expect(result?.confidence.iban).toBe(0)
  })

  it('an explicit null field is treated the same as missing', () => {
    const raw = JSON.parse(FULL_RESPONSE)
    raw.tour_date = null
    const result = parseExtractionResponse(raw)
    expect(result?.fields.tourDate).toBeNull()
    expect(result?.confidence.tourDate).toBe(0)
  })

  it('a numeric field given as a non-number string is treated as not found', () => {
    const raw = JSON.parse(FULL_RESPONSE)
    raw.amount_cents = 'tachtig euro'
    const result = parseExtractionResponse(raw)
    expect(result?.fields.amountCents).toBeNull()
    expect(result?.confidence.amountCents).toBe(0)
  })

  it('an empty string field is treated as not found', () => {
    const raw = JSON.parse(FULL_RESPONSE)
    raw.supplier_name = '   '
    const result = parseExtractionResponse(raw)
    expect(result?.fields.supplierName).toBeNull()
  })

  it('confidence is clamped into 0..1', () => {
    const raw = JSON.parse(FULL_RESPONSE)
    raw.confidence.invoice_number = 5
    raw.confidence.iban = -2
    const result = parseExtractionResponse(raw)
    expect(result?.confidence.invoiceNumber).toBe(1)
    expect(result?.confidence.iban).toBe(0)
  })

  it('a confidence object missing entirely still parses fields, all confidence 0', () => {
    const raw = JSON.parse(FULL_RESPONSE)
    delete raw.confidence
    const result = parseExtractionResponse(raw)
    expect(result?.fields.invoiceNumber).toBe('INV-042')
    expect(result?.confidence.invoiceNumber).toBe(0)
  })

  it('every field missing → all null, all zero confidence, still a valid result (not null)', () => {
    const result = parseExtractionResponse({})
    expect(result).not.toBeNull()
    expect(result?.fields.invoiceNumber).toBeNull()
    expect(result?.fields.amountCents).toBeNull()
    expect(Object.values(result?.confidence ?? {}).every(c => c === 0)).toBe(true)
  })
})

describe('extractInvoiceFields', () => {
  it('parses a clean Gemini response end to end', async () => {
    const result = await extractInvoiceFields('base64pdf', { gemini: mockGemini(FULL_RESPONSE) })
    expect(result.fields.invoiceNumber).toBe('INV-042')
    expect(result.fields.amountCents).toBe(8000)
    expect(result.confidence.bookingRef).toBe(0.5)
  })

  it('strips a markdown JSON fence before parsing', async () => {
    const fenced = '```json\n' + FULL_RESPONSE + '\n```'
    const result = await extractInvoiceFields('base64pdf', { gemini: mockGemini(fenced) })
    expect(result.fields.invoiceNumber).toBe('INV-042')
  })

  it('retries once on a transient 503, then succeeds', async () => {
    // The retry sleeps 4s for real; advance a fake clock instead of eating 80% of the 5s test timeout.
    vi.useFakeTimers()
    try {
      const gemini = mockGeminiSequence([new Error('503 Service Unavailable'), FULL_RESPONSE])
      const pending = extractInvoiceFields('base64pdf', { gemini, maxRetries: 2 })
      await vi.advanceTimersByTimeAsync(4000)
      const result = await pending
      expect(result.fields.invoiceNumber).toBe('INV-042')
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws immediately on a non-503 error, no retry', async () => {
    const gemini = mockGeminiSequence([new Error('400 Bad Request')])
    await expect(extractInvoiceFields('base64pdf', { gemini })).rejects.toThrow('400 Bad Request')
  })

  it('throws when the response is not valid JSON at all', async () => {
    const gemini = mockGemini('Sorry, I cannot read this PDF.')
    await expect(extractInvoiceFields('base64pdf', { gemini })).rejects.toThrow(/unparseable/)
  })
})
