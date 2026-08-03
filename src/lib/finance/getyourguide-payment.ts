// Parses a GetYourGuide "Your payment is confirmed" PDF — one payout per
// email, no per-booking breakdown (unlike Viator's spreadsheet). See
// getyourguide-payment.test.ts for the exact text shape this expects (based
// on a real payment-confirmation PDF).

import { toCents } from './shared'

const MONTHS: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
}

export interface GetYourGuidePayment {
  paymentNumber: string | null
  paymentRunDate: string | null
  accountNumber: string | null
  invoiceNumber: string | null
  amountCents: number | null
}

// "July 6, 2026" -> "2026-07-06"
function parseLongDate(value: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(value.trim())
  if (!m) return null
  const [, monthName, day, year] = m
  const monthIndex = MONTHS[monthName]
  if (monthIndex == null) return null
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
}

/**
 * Parses the flattened text content of a GetYourGuide payment-confirmation
 * PDF (already extracted via pdfjs). Kept separate from the PDF I/O so the
 * parsing logic itself is trivially unit-testable with a plain string.
 */
export function parseGetYourGuidePaymentText(rawText: string): GetYourGuidePayment {
  // pdfjs can emit extra whitespace items between words depending on the PDF
  // generator — collapse runs of whitespace so labels match reliably.
  const text = rawText.replace(/\s+/g, ' ')
  const paymentNumber = /Payment number\s+([A-Z0-9]+)/.exec(text)?.[1] ?? null
  const paymentRunDateRaw = /Payment run date\s+([A-Za-z]+ \d{1,2},\s*\d{4})/.exec(text)?.[1] ?? null
  const accountNumber = /Account number\s+(\d+)/.exec(text)?.[1] ?? null
  const invoiceNumber = /Invoice\s+([A-Z0-9-]+)/.exec(text)?.[1] ?? null
  const totalPaymentRaw = /Total Payment\s+([\d,]+\.\d{2})/.exec(text)?.[1] ?? null

  return {
    paymentNumber,
    paymentRunDate: paymentRunDateRaw ? parseLongDate(paymentRunDateRaw) : null,
    accountNumber,
    invoiceNumber,
    amountCents: totalPaymentRaw ? toCents(totalPaymentRaw) : null,
  }
}

/** Reads an uploaded PDF buffer and extracts the payment confirmation from its text content. */
export async function parseGetYourGuidePaymentPdf(buffer: Buffer | ArrayBuffer): Promise<GetYourGuidePayment> {
  // pdfjs-dist is externalized (see next.config.ts serverExternalPackages) so
  // its own dynamic worker-file resolution runs untouched by webpack.
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(buffer)
  const doc = await pdfjsLib.getDocument({ data }).promise
  let text = ''
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    text += content.items.map(item => ('str' in item ? item.str : '')).join(' ') + ' '
  }
  return parseGetYourGuidePaymentText(text)
}
