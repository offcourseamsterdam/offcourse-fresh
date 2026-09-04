/**
 * Gemini PDF → structured invoice fields (§6, docs/plans/2026-09-04-financial-management-module.md).
 *
 * A skipper or supplier sends a PDF invoice; this pulls out exactly the
 * fields invoices/match.ts needs to check it. Split in two on purpose:
 * `parseExtractionResponse` is a pure function of Gemini's raw JSON text
 * (fully testable with fixtures, no network), and `extractInvoiceFields`
 * is the thin wrapper that actually calls the model, mirroring
 * describe-image.ts's retry-on-503 + metered-usage pattern.
 *
 * The one rule that matters more than any field: never invent a value.
 * A field Gemini can't find comes back null with confidence 0 — match.ts
 * already treats every null field as a failed check, so a bad guess here
 * would silently pass a check that should have stopped the payment.
 */

import type { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_MODEL, getGemini } from '@/lib/ai/clients'
import { recordAiUsage } from '@/lib/ai/usage'
import { extractJson } from '@/lib/ghost/ops-drafters'
import type { ExtractedInvoiceFields } from './match'

const FIELD_KEYS = [
  'invoiceNumber',
  'invoiceDate',
  'supplierName',
  'iban',
  'tourDate',
  'bookingRef',
  'hours',
  'rateCents',
  'amountCents',
  'vatCents',
] as const satisfies readonly (keyof ExtractedInvoiceFields)[]

// snake_case wire keys, in the same order as FIELD_KEYS — Gemini writes JSON, not TS.
const WIRE_KEYS = [
  'invoice_number',
  'invoice_date',
  'supplier_name',
  'iban',
  'tour_date',
  'booking_ref',
  'hours',
  'rate_cents',
  'amount_cents',
  'vat_cents',
] as const

export type FieldConfidence = Partial<Record<keyof ExtractedInvoiceFields, number>>

export interface ExtractionResult {
  fields: ExtractedInvoiceFields
  confidence: FieldConfidence
}

export const EXTRACT_INVOICE_PROMPT = `You are reading a supplier or skipper invoice for Off Course Amsterdam, an electric boat cruise company. Extract exactly these fields from the PDF. If a field is not present or you are not confident, use null — NEVER guess or estimate a value that isn't clearly written on the document.

Fields:
- invoice_number: the invoice's own reference/number, as printed
- invoice_date: the date the invoice was issued, as YYYY-MM-DD
- supplier_name: the sender's name (person or company)
- iban: the bank account (IBAN) to pay, digits and letters only, no spaces
- tour_date: the date of the cruise/shift this invoice is for, as YYYY-MM-DD (this is the operational date being billed, which may differ from invoice_date)
- booking_ref: a booking or reference code tying this to a specific cruise, if one is written down
- hours: number of hours billed, as a plain number (e.g. 4 or 4.5)
- rate_cents: the hourly rate in EURO CENTS (e.g. €20.00/hour = 2000)
- amount_cents: the total amount due in EURO CENTS (e.g. €80.00 = 8000)
- vat_cents: VAT/BTW amount in EURO CENTS, or 0 if the invoice is VAT-exempt/reverse-charged

Also return a confidence score (0 to 1) for each field: 1 = clearly and unambiguously stated, lower = you had to infer or the text was unclear, 0 = not found.

Return JSON only, in this exact shape:
{"invoice_number": "...", "invoice_date": "...", "supplier_name": "...", "iban": "...", "tour_date": "...", "booking_ref": "...", "hours": 0, "rate_cents": 0, "amount_cents": 0, "vat_cents": 0, "confidence": {"invoice_number": 1, "invoice_date": 1, "supplier_name": 1, "iban": 1, "tour_date": 1, "booking_ref": 1, "hours": 1, "rate_cents": 1, "amount_cents": 1, "vat_cents": 1}}`

/** Validates + normalizes Gemini's raw JSON reply. Pure — no network, fully fixture-testable. Returns null when the shape is unusable (not even a valid confidence-scored object). */
export function parseExtractionResponse(raw: Record<string, unknown> | null): ExtractionResult | null {
  if (!raw) return null

  const confidenceRaw = raw.confidence
  const confidenceObj = confidenceRaw && typeof confidenceRaw === 'object' ? (confidenceRaw as Record<string, unknown>) : {}

  const fields: Record<string, unknown> = {}
  const confidence: FieldConfidence = {}

  FIELD_KEYS.forEach((key, i) => {
    const wireKey = WIRE_KEYS[i]
    const value = raw[wireKey]
    const conf = confidenceObj[wireKey]
    const confNum = typeof conf === 'number' && Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0

    if (key === 'hours' || key === 'rateCents' || key === 'amountCents' || key === 'vatCents') {
      const num = typeof value === 'number' && Number.isFinite(value) ? value : null
      fields[key] = num
      confidence[key] = num === null ? 0 : confNum
    } else {
      const str = typeof value === 'string' && value.trim() ? value.trim() : null
      fields[key] = str
      confidence[key] = str === null ? 0 : confNum
    }
  })

  return { fields: fields as unknown as ExtractedInvoiceFields, confidence }
}

/**
 * Calls Gemini on a base64-encoded invoice PDF and returns extracted fields.
 * Best-effort retry on a transient 503, same as describeImageWithGemini;
 * throws on anything else, or when the response can't be parsed at all —
 * the caller (the finance-inbox sync step) marks the invoice needs_review
 * with an "extractie mislukt" note rather than swallowing this silently.
 */
export async function extractInvoiceFields(
  pdfBase64: string,
  opts: { gemini?: GoogleGenerativeAI; feature?: string; maxRetries?: number } = {},
): Promise<ExtractionResult> {
  const feature = opts.feature ?? 'finance_invoice_extract'
  const gemini = opts.gemini ?? getGemini()
  const model = gemini.getGenerativeModel({ model: GEMINI_MODEL })

  let retries = opts.maxRetries ?? 2
  let result: Awaited<ReturnType<typeof model.generateContent>>
  for (;;) {
    try {
      result = await model.generateContent([
        { text: EXTRACT_INVOICE_PROMPT },
        { inlineData: { data: pdfBase64, mimeType: 'application/pdf' } },
      ])
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (retries > 0 && msg.includes('503')) {
        retries--
        await new Promise(r => setTimeout(r, 4000))
        continue
      }
      throw err
    }
  }

  const usage = result.response.usageMetadata
  await recordAiUsage({
    feature,
    model: GEMINI_MODEL,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  })

  const parsed = parseExtractionResponse(extractJson(result.response.text()))
  if (!parsed) throw new Error('Gemini invoice extraction returned an unparseable response')
  return parsed
}
