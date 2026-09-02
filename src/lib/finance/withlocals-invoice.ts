// Parses a Withlocals "New invoice for booking" PDF. Withlocals invoices Off
// Course once per booking. Each invoice states:
//   - the guest's Tour price (the gross revenue — what the guest paid),
//   - Withlocals' service fee (their commission, ~32%, WITH 21% VAT that Off
//     Course can deduct as input VAT),
//   - the Net payable to host (what Withlocals actually pays out).
//
// Crucially, the 9% OUTPUT VAT on the cruise revenue is NOT on this invoice —
// Withlocals explicitly states the host determines their own tax. So the tour
// price is the gross (incl 9%) consumer price, and the 9% split is derived
// downstream (see withlocals-summary.ts), not read from the PDF.
//
// pdfjs flattens the PDF to a single text stream; every field here is a
// single label/value pair, so plain regex on the flattened text is enough
// (no positional reconstruction like the BoatLocal table needs).

import { toCents as sharedToCents } from './shared'
import './pdfjs-node-polyfill'

const MONTHS: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
}

export interface WithlocalsInvoice {
  bookingId: string | null
  invoiceNumber: string | null
  invoiceDate: string | null // YYYY-MM-DD
  tourName: string | null
  tripAt: string | null // ISO-ish, as printed (e.g. "2026-06-21T15:00")
  guestCount: number | null
  tourPriceCents: number | null // gross revenue, incl 9% VAT
  serviceFeeInclCents: number | null // Withlocals commission incl VAT
  serviceFeeVatCents: number | null // 21% VAT on the commission (deductible)
  serviceFeeExCents: number | null
  netPayoutCents: number | null // what Withlocals pays out to the host
}

// "€ 247.50" / "€1,405.44" -> 24750 / 140544. Unparseable → 0 (the canonical
// toCents returns null on failure; this source's call sites expect a plain number).
function toCents(value: string): number {
  return sharedToCents(value) ?? 0
}

// "May 18 2026" -> "2026-05-18"
function parseInvoiceDate(monthName: string, day: string, year: string): string | null {
  const m = MONTHS[monthName]
  if (m == null) return null
  return `${year}-${String(m + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
}

/**
 * Parses the fields out of the flattened (space-joined) text of a Withlocals
 * invoice PDF. Returns nulls for anything it can't find rather than throwing —
 * the caller decides whether a missing booking id / amount is fatal.
 */
export function parseWithlocalsInvoiceText(rawText: string): WithlocalsInvoice {
  const text = rawText.replace(/\s+/g, ' ')

  const bookingId = /Booking identifier:\s*([0-9a-fA-F]{8}-[0-9a-fA-F-]{27})/.exec(text)?.[1] ?? null
  const invoiceNumber = /Invoice number #\s*(\d+)/.exec(text)?.[1] ?? null

  const dateMatch = /Invoice Date:\s*[A-Za-z]+\s+([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/.exec(text)
  const invoiceDate = dateMatch ? parseInvoiceDate(dateMatch[1], dateMatch[2], dateMatch[3]) : null

  const descMatch = /Booking description:\s*'([^']+)'\s+on\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\s+with\s+(\d+)\s+guests?/.exec(text)
  const tourName = descMatch?.[1] ?? null
  const tripAt = descMatch?.[2] ?? null
  const guestCount = descMatch ? parseInt(descMatch[3], 10) : null

  const tourPriceCents = extractAmount(text, /Tour price\s+\d+\s+€\s*([\d,.]+)/)

  // "Service fee Withlocals 32% € 79.20 € 13.75 € 65.45" -> incl, vat, ex
  const feeMatch = /Service fee Withlocals\s+\d+%\s+€\s*([\d,.]+)\s+€\s*([\d,.]+)\s+€\s*([\d,.]+)/.exec(text)
  const serviceFeeInclCents = feeMatch ? toCents(feeMatch[1]) : null
  const serviceFeeVatCents = feeMatch ? toCents(feeMatch[2]) : null
  const serviceFeeExCents = feeMatch ? toCents(feeMatch[3]) : null

  const netPayoutCents = extractAmount(text, /Net payable to host by Withlocals\s+€\s*([\d,.]+)/)

  return {
    bookingId,
    invoiceNumber,
    invoiceDate,
    tourName,
    tripAt,
    guestCount,
    tourPriceCents,
    serviceFeeInclCents,
    serviceFeeVatCents,
    serviceFeeExCents,
    netPayoutCents,
  }
}

function extractAmount(text: string, re: RegExp): number | null {
  const m = re.exec(text)
  return m ? toCents(m[1]) : null
}

/** Reads an uploaded Withlocals invoice PDF buffer and extracts its fields. */
export async function parseWithlocalsInvoicePdf(buffer: Buffer | ArrayBuffer): Promise<WithlocalsInvoice> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(buffer)
  const doc = await pdfjsLib.getDocument({ data }).promise

  let flatText = ''
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    for (const item of content.items) {
      if ('str' in item) flatText += item.str + ' '
    }
  }

  return parseWithlocalsInvoiceText(flatText)
}
