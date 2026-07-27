// Parses a Viator "Payment Advice" spreadsheet — the monthly remittance email
// (finance@viator.com) that lists every booking paid out in that transfer,
// plus the total amount that lands in the bank. See viator-payment-advice.test.ts
// for the exact row shape this expects (based on a real advice document).
import ExcelJS from 'exceljs'
import { toCents as sharedToCents } from './shared'

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}

export interface ViatorPaymentLine {
  viatorReference: string
  arrivalDate: string | null
  saleDate: string | null
  vendorReference: string | null
  grossAmount: number
  grossCurrency: string | null
  convertedAmountCents: number
  tourGradeCode: string | null
  tourGradeTitle: string | null
}

export interface ViatorPaymentAdvice {
  documentNumber: string | null
  adviceDate: string | null
  totalAmountCents: number | null
  lines: ViatorPaymentLine[]
}

// Thin adapter: ExcelJS cell values are `unknown` (string | number | Date | ...);
// the canonical toCents takes string | number.
function toCents(value: unknown): number | null {
  if (value == null) return null
  return sharedToCents(String(value))
}

// "MM/DD/YYYY" -> "YYYY-MM-DD"
function parseSlashDate(value: unknown): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value ?? ''))
  if (!m) return null
  const [, mm, dd, yyyy] = m
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

// "08-Jul-26" -> "2026-07-08"
function parseAdviceDate(value: unknown): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!m) return null
  const [, dd, mon, yy] = m
  const monthIndex = MONTHS[mon]
  if (monthIndex == null) return null
  const year = 2000 + parseInt(yy, 10)
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function cell(row: unknown[], index: number | undefined): unknown {
  return index == null ? null : row[index]
}

function textOrNull(value: unknown): string | null {
  const s = value == null ? '' : String(value).trim()
  return s.length > 0 ? s : null
}

/**
 * Parses already-extracted sheet rows (one array per row, 0-indexed columns,
 * empty cells as null/undefined). Kept separate from the exceljs I/O so the
 * parsing logic itself is trivially unit-testable with plain fixtures.
 */
export function parseViatorSheetRows(rows: unknown[][], filename?: string): ViatorPaymentAdvice {
  let adviceDate: string | null = null
  for (const row of rows) {
    const found = row.map(parseAdviceDate).find(Boolean)
    if (found) { adviceDate = found; break }
  }

  const headerRowIndex = rows.findIndex(row => row.some(c => c === 'VIATOR REFERENCE'))
  if (headerRowIndex === -1) {
    return { documentNumber: filename?.split('_')[0] ?? null, adviceDate, totalAmountCents: null, lines: [] }
  }

  const header = rows[headerRowIndex]
  const col = (name: string) => {
    const i = header.findIndex(c => c === name)
    return i === -1 ? undefined : i
  }
  const idx = {
    reference: col('VIATOR REFERENCE'),
    arrival: col('ARRIVAL DATE'),
    sale: col('SALE DATE'),
    vendor: col('VENDOR REFERENCE'),
    amount: col('AMOUNT'),
    currency: col('CURRENCY'),
    converted: col('CONVERTED AMOUNT'),
    tourCode: col('TOUR GRADE CODE'),
    tourTitle: col('TOUR GRADE TITLE'),
  }

  // Viator omits CONVERTED AMOUNT/CURRENCY entirely when every line in the
  // advice is already in EUR (nothing to convert) — fall back to AMOUNT,
  // which in that case already IS the EUR figure.
  const convertedIdx = idx.converted ?? idx.amount

  const lines: ViatorPaymentLine[] = []
  let totalAmountCents: number | null = null

  for (const row of rows.slice(headerRowIndex + 1)) {
    const reference = textOrNull(cell(row, idx.reference))
    if (!reference) continue
    if (reference === 'TOTAL PAYMENT') {
      totalAmountCents = toCents(cell(row, convertedIdx))
      break
    }
    lines.push({
      viatorReference: reference,
      arrivalDate: parseSlashDate(cell(row, idx.arrival)),
      saleDate: parseSlashDate(cell(row, idx.sale)),
      vendorReference: textOrNull(cell(row, idx.vendor)),
      grossAmount: parseFloat(String(cell(row, idx.amount) ?? '').replace(/,/g, '')) || 0,
      grossCurrency: textOrNull(cell(row, idx.currency)),
      convertedAmountCents: toCents(cell(row, convertedIdx)) ?? 0,
      tourGradeCode: textOrNull(cell(row, idx.tourCode)),
      tourGradeTitle: textOrNull(cell(row, idx.tourTitle)),
    })
  }

  return {
    documentNumber: filename?.split('_')[0] ?? null,
    adviceDate,
    totalAmountCents,
    lines,
  }
}

/** Reads an uploaded .xlsx buffer and extracts the payment advice from its first sheet. */
export async function parseViatorPaymentAdviceFile(
  buffer: Buffer | ArrayBuffer,
  filename?: string,
): Promise<ViatorPaymentAdvice> {
  const workbook = new ExcelJS.Workbook()
  // exceljs's own .d.ts redeclares a minimal ambient `Buffer` interface that
  // conflicts with @types/node's — `any` sidesteps that third-party typing bug.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any)
  const sheet = workbook.worksheets[0]
  if (!sheet) return { documentNumber: filename?.split('_')[0] ?? null, adviceDate: null, totalAmountCents: null, lines: [] }

  const rows: unknown[][] = []
  sheet.eachRow({ includeEmpty: false }, row => {
    // ExcelJS row.values is 1-indexed (index 0 is always empty) — drop it to
    // match the plain 0-indexed rows the pure parser expects.
    const values = Array.isArray(row.values) ? row.values.slice(1) : []
    rows.push(values)
  })

  return parseViatorSheetRows(rows, filename)
}
