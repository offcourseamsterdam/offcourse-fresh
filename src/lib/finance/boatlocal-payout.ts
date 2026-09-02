// Parses a BoatLocal "Operator Invoice" PDF — BoatLocal's monthly payout to
// Off Course for bookings made through their platform. Unlike the other two
// PDF sources, this one includes a real VAT breakdown (9% on sales, 21% on
// BoatLocal's commission) and a full per-booking table across possibly
// several pages, with no repeated header after page 1.
//
// pdfjs gives text as a flat, position-tagged stream (no row/column
// structure), so the per-booking table has to be reconstructed from x/y
// coordinates: a new row starts at each "D Mon" date token in the DATE
// column; everything after it (until the next date or the page footer)
// is bucketed into a column by x-position. See boatlocal-payout.test.ts.

import { toCents as sharedToCents } from './shared'
import './pdfjs-node-polyfill'

const MONTHS: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
}

export interface PositionedText {
  str: string
  x: number
  y: number
}

export interface BoatLocalPayoutLine {
  bookingDate: string | null
  guestName: string | null
  guestCount: number | null
  cruiseName: string | null
  totalCents: number
  exVatCents: number
  inclVatCents: number
}

export interface BoatLocalPayout {
  invoiceNumber: string | null
  issueDate: string | null
  periodStart: string | null
  periodEnd: string | null
  totalSalesInclVatCents: number | null
  totalSalesExclVatCents: number | null
  commissionExVatCents: number | null
  vat21Cents: number | null
  totalWithheldCents: number | null
  operatorPayoutCents: number | null
  vat9InPayoutCents: number | null
  lines: BoatLocalPayoutLine[]
}

// Unparseable → 0 (the canonical toCents returns null on failure; this source's
// call sites expect a plain number).
function toCents(value: string): number {
  return sharedToCents(value) ?? 0
}

// "8 July 2026" -> "2026-07-08"
function parseLongDate(value: string): string | null {
  const m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(value.trim())
  if (!m) return null
  const [, day, monthName, year] = m
  const monthIndex = MONTHS[monthName]
  if (monthIndex == null) return null
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
}

const MONTH_ABBR: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}

// "2 Apr" + year 2026 -> "2026-04-02"
function parseShortDate(value: string, year: number): string | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})$/.exec(value.trim())
  if (!m) return null
  const [, day, monthAbbr] = m
  const monthIndex = MONTH_ABBR[monthAbbr]
  if (monthIndex == null) return null
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
}

function extractAmount(text: string, label: string): number | null {
  const re = new RegExp(`${label}\\s*€([\\d,.]+)`)
  const m = re.exec(text)
  return m ? toCents(m[1]) : null
}

/**
 * Parses the summary header fields from the flattened (space-joined) text
 * of a BoatLocal invoice PDF — these are single-line label/value pairs, so
 * no position data is needed for them.
 */
export function parseBoatLocalSummaryText(rawText: string): Omit<BoatLocalPayout, 'lines'> {
  // pdfjs can emit extra whitespace items between words depending on the PDF
  // generator — collapse runs of whitespace so every regex below can assume
  // a single space between words, matching how the label text actually reads.
  const text = rawText.replace(/\s+/g, ' ')
  const invoiceNumber = /OPERATOR INVOICE\s*([A-Z0-9-]+)/.exec(text)?.[1] ?? null
  const issueDateRaw = /Issue date\s*(\d{1,2} [A-Za-z]+ \d{4})/.exec(text)?.[1] ?? null
  const periodMatch = /Period\s*(\d{1,2} [A-Za-z]+ \d{4})\s*—\s*(\d{1,2} [A-Za-z]+ \d{4})/.exec(text)

  return {
    invoiceNumber,
    issueDate: issueDateRaw ? parseLongDate(issueDateRaw) : null,
    periodStart: periodMatch ? parseLongDate(periodMatch[1]) : null,
    periodEnd: periodMatch ? parseLongDate(periodMatch[2]) : null,
    totalSalesInclVatCents: extractAmount(text, 'Total Sales \\(incl 9% VAT\\)'),
    totalSalesExclVatCents: extractAmount(text, 'Total Sales \\(excl 9% VAT\\)'),
    commissionExVatCents: extractAmount(text, 'Commission \\(ex 21% VAT\\)'),
    vat21Cents: extractAmount(text, 'VAT 21%'),
    totalWithheldCents: extractAmount(text, 'Total Withheld'),
    operatorPayoutCents: extractAmount(text, 'Operator Payout'),
    vat9InPayoutCents: extractAmount(text, 'VAT \\(9%\\) inside Operator Payout[^€]*'),
  }
}

const DATE_TOKEN = /^\d{1,2}\s+[A-Za-z]{3}$/
const FOOTER_MARKER = 'Boat Local · KVK'

/**
 * Reconstructs the per-booking table from position-tagged text items across
 * however many pages the invoice spans. `year` comes from the parsed period
 * (line dates are "D Mon" only, no year).
 */
export function parseBoatLocalLines(items: PositionedText[], year: number): BoatLocalPayoutLine[] {
  const nonEmpty = items.filter(i => i.str.trim().length > 0)

  const rows: PositionedText[][] = []
  // Once the footer marker is seen, EVERYTHING until the next date-anchored
  // row is footer content (e.g. "Invoice BL-..." sits right next to it) —
  // skipping only the marker itself let that trailing text leak into the
  // previous row and silently clobber its EX VAT/INCL VAT cells with 0.
  let inFooter = false
  for (const item of nonEmpty) {
    const isRowStart = DATE_TOKEN.test(item.str) && item.x < 80
    if (item.str.startsWith(FOOTER_MARKER)) {
      inFooter = true
      continue
    }
    if (isRowStart) {
      inFooter = false
      rows.push([item])
    } else if (inFooter) {
      continue
    } else if (rows.length > 0) {
      rows[rows.length - 1].push(item)
    }
    // items before the first date token (header, summary) are ignored
  }

  return rows.map(row => {
    const [dateItem, ...rest] = row
    let guestName: string | null = null
    let guestCount: number | null = null
    const cruiseParts: string[] = []
    let totalCents = 0
    let exVatCents = 0
    let inclVatCents = 0

    for (const item of rest) {
      const x = item.x
      if (x < 170) {
        guestName = guestName ? `${guestName} ${item.str}` : item.str
      } else if (x < 215) {
        const n = parseInt(item.str, 10)
        if (!Number.isNaN(n)) guestCount = n
      } else if (x < 370) {
        cruiseParts.push(item.str)
      } else if (x < 440) {
        totalCents = toCents(item.str.replace('€', ''))
      } else if (x < 490) {
        exVatCents = toCents(item.str.replace('€', ''))
      } else {
        inclVatCents = toCents(item.str.replace('€', ''))
      }
    }

    return {
      bookingDate: parseShortDate(dateItem.str, year),
      guestName,
      guestCount,
      cruiseName: cruiseParts.join(' ').replace(/-\s+([a-z])/g, '$1') || null,
      totalCents,
      exVatCents,
      inclVatCents,
    }
  })
}

/** Reads an uploaded PDF buffer and extracts the full BoatLocal payout (summary + lines). */
export async function parseBoatLocalPayoutPdf(buffer: Buffer | ArrayBuffer): Promise<BoatLocalPayout> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(buffer)
  const doc = await pdfjsLib.getDocument({ data }).promise

  let flatText = ''
  const positioned: PositionedText[] = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    for (const item of content.items) {
      if (!('str' in item)) continue
      flatText += item.str + ' '
      positioned.push({ str: item.str, x: item.transform[4], y: item.transform[5] })
    }
  }

  const summary = parseBoatLocalSummaryText(flatText)
  const year = summary.periodStart ? parseInt(summary.periodStart.slice(0, 4), 10) : new Date().getUTCFullYear()
  const lines = parseBoatLocalLines(positioned, year)

  return { ...summary, lines }
}
