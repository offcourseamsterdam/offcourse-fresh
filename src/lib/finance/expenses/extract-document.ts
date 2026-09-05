/**
 * Gemini (vision) → the generic fields of ANY purchase document: an invoice
 * PDF from a webshop, a receipt photo from the Revolut app, a scanned bon.
 * The skipper-invoice extractor (invoices/extract.ts) stays as is — it asks
 * about hours and tour dates that make no sense for a bol.com order; this one
 * asks about order numbers, payment references and the VAT split.
 *
 * Same two-part shape as extract.ts: `parseDocumentExtraction` is pure over
 * the model's JSON (fixture-tested), `extractDocumentFields` is the thin call
 * with the same 503 retry + metered usage. Same one rule above all: a value
 * the document doesn't clearly state comes back null with confidence 0 —
 * never estimated. A guessed VAT figure would silently corrupt the BTW
 * position this whole module exists to make accurate.
 */
import type { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_MODEL, getGemini } from '@/lib/ai/clients'
import { recordAiUsage } from '@/lib/ai/usage'
import { extractJson } from '@/lib/ghost/ops-drafters'

export interface DocumentFields {
  supplierName: string | null
  orderNumber: string | null
  invoiceNumber: string | null
  /** YYYY-MM-DD */
  invoiceDate: string | null
  grossCents: number | null
  netCents: number | null
  vatCents: number | null
  vatRatePct: number | null
  currency: string | null
  iban: string | null
  paymentReference: string | null
  /** 'invoice' | 'receipt' | 'order_confirmation' | 'other' — what the document itself is. */
  documentKind: 'invoice' | 'receipt' | 'order_confirmation' | 'other' | null
}

export type DocumentConfidence = Partial<Record<keyof DocumentFields, number>>

export interface DocumentExtraction {
  fields: DocumentFields
  confidence: DocumentConfidence
}

const STRING_KEYS = ['supplier_name', 'order_number', 'invoice_number', 'invoice_date', 'currency', 'iban', 'payment_reference'] as const
const NUMBER_KEYS = ['gross_cents', 'net_cents', 'vat_cents', 'vat_rate_pct'] as const
const KINDS = new Set(['invoice', 'receipt', 'order_confirmation', 'other'])

const WIRE_TO_FIELD: Record<string, keyof DocumentFields> = {
  supplier_name: 'supplierName',
  order_number: 'orderNumber',
  invoice_number: 'invoiceNumber',
  invoice_date: 'invoiceDate',
  gross_cents: 'grossCents',
  net_cents: 'netCents',
  vat_cents: 'vatCents',
  vat_rate_pct: 'vatRatePct',
  currency: 'currency',
  iban: 'iban',
  payment_reference: 'paymentReference',
  document_kind: 'documentKind',
}

export const EXTRACT_DOCUMENT_PROMPT = `You are reading a purchase document for Off Course Amsterdam, a small electric boat cruise company in the Netherlands: an invoice, a till receipt, or an order confirmation. Extract exactly these fields. If a field is not present or you are not confident, use null — NEVER guess, estimate, or compute a value that is not clearly written on the document.

Fields:
- document_kind: one of "invoice", "receipt", "order_confirmation", "other"
- supplier_name: the seller/merchant name as printed
- order_number: the order/bestelnummer, if printed
- invoice_number: the invoice/factuurnummer or receipt number, if printed
- invoice_date: the document date as YYYY-MM-DD
- gross_cents: the total amount paid/due INCLUDING VAT, in EURO CENTS (€121,00 = 12100)
- net_cents: the total EXCLUDING VAT in EURO CENTS, only if printed (do not compute it)
- vat_cents: the VAT/BTW amount in EURO CENTS, only if printed (do not compute it). A document that states 0% / vrijgesteld / verlegd → 0
- vat_rate_pct: the VAT percentage as a number (21, 9, 0), only if printed. If several rates appear, use null.
- currency: ISO code, e.g. "EUR"
- iban: the IBAN to pay, letters and digits only, no spaces, only if printed
- payment_reference: a payment reference / betalingskenmerk / "omschrijving" the payer was asked to use, if printed

Also return a confidence score (0 to 1) per field: 1 = clearly and unambiguously printed, lower = unclear, 0 = not found.

Return JSON only, in this exact shape:
{"document_kind":"invoice","supplier_name":"...","order_number":"...","invoice_number":"...","invoice_date":"YYYY-MM-DD","gross_cents":0,"net_cents":0,"vat_cents":0,"vat_rate_pct":0,"currency":"EUR","iban":"...","payment_reference":"...","confidence":{"document_kind":1,"supplier_name":1,"order_number":1,"invoice_number":1,"invoice_date":1,"gross_cents":1,"net_cents":1,"vat_cents":1,"vat_rate_pct":1,"currency":1,"iban":1,"payment_reference":1}}`

/** Pure: validates + normalises the model's JSON. Null when the shape is unusable. */
export function parseDocumentExtraction(raw: Record<string, unknown> | null): DocumentExtraction | null {
  if (!raw || typeof raw !== 'object') return null
  const confRaw = raw.confidence
  const confObj = confRaw && typeof confRaw === 'object' ? (confRaw as Record<string, unknown>) : {}
  const conf = (wire: string, present: boolean): number => {
    if (!present) return 0
    const c = confObj[wire]
    return typeof c === 'number' && Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0
  }

  const fields = {} as Record<keyof DocumentFields, unknown>
  const confidence: DocumentConfidence = {}

  for (const wire of STRING_KEYS) {
    const v = raw[wire]
    const str = typeof v === 'string' && v.trim() ? v.trim() : null
    const key = WIRE_TO_FIELD[wire]
    fields[key] = str
    confidence[key] = conf(wire, str !== null)
  }
  for (const wire of NUMBER_KEYS) {
    const v = raw[wire]
    // Cents are integers; a rate may be 21 or 9 — still an integer in practice, but tolerate 21.0.
    const num = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? (wire === 'vat_rate_pct' ? v : Math.round(v)) : null
    const key = WIRE_TO_FIELD[wire]
    fields[key] = num
    confidence[key] = conf(wire, num !== null)
  }
  const kindRaw = raw.document_kind
  const kind = typeof kindRaw === 'string' && KINDS.has(kindRaw) ? (kindRaw as DocumentFields['documentKind']) : null
  fields.documentKind = kind
  confidence.documentKind = conf('document_kind', kind !== null)

  // Normalise the IBAN the way the pay path expects it.
  if (typeof fields.iban === 'string') fields.iban = fields.iban.replace(/\s+/g, '').toUpperCase()
  if (typeof fields.currency === 'string') fields.currency = fields.currency.toUpperCase()

  return { fields: fields as unknown as DocumentFields, confidence }
}

/**
 * Sends the document bytes to Gemini. `mimeType` must be what sniffDocumentType
 * decided, never what the sender claimed. Throws on an unparseable reply so the
 * caller can leave the document visible-but-unextracted rather than half-filled.
 */
export async function extractDocumentFields(
  base64: string,
  mimeType: string,
  opts: { gemini?: GoogleGenerativeAI; feature?: string; maxRetries?: number } = {},
): Promise<DocumentExtraction> {
  const feature = opts.feature ?? 'finance_expense_document_extract'
  const gemini = opts.gemini ?? getGemini()
  const model = gemini.getGenerativeModel({ model: GEMINI_MODEL })

  let retries = opts.maxRetries ?? 2
  let result: Awaited<ReturnType<typeof model.generateContent>>
  for (;;) {
    try {
      result = await model.generateContent([{ text: EXTRACT_DOCUMENT_PROMPT }, { inlineData: { data: base64, mimeType } }])
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
  await recordAiUsage({ feature, model: GEMINI_MODEL, inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 })

  const parsed = parseDocumentExtraction(extractJson(result.response.text()))
  if (!parsed) throw new Error('Gemini document extraction returned an unparseable response')
  return parsed
}
