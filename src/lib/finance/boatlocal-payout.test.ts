import { describe, it, expect } from 'vitest'
import {
  parseBoatLocalSummaryText,
  parseBoatLocalLines,
  parseBoatLocalPayoutPdf,
  type PositionedText,
} from './boatlocal-payout'

// Mirrors a real BoatLocal "Operator Invoice" PDF's flattened text — see
// session notes for the source. Fields, layout and labels are real;
// customer names below are synthetic (never commit real guest PII).
const SUMMARY_TEXT = `boatlocal Authentic Boat Tours Amsterdam OPERATOR INVOICE BL-2026-06-OP-0008 Issue date 8 July 2026 Period 1 June 2026 — 30 June 2026 FROM Boat Local Bilderdijkstraat 58H 1053KV Amsterdam KVK: 65990190 BTW: NL000000000B00 info@boatlocal.nl OPERATOR Off Course info@offcourseamsterdam.com +31 6 45351618 Invoice Summary Total Sales (incl 9% VAT) €245.00 Total Sales (excl 9% VAT) €224.77 Commission (ex 21% VAT) €44.95 VAT 21% €9.44 Total Withheld €54.39 Operator Payout €190.61 VAT (9%) inside Operator Payout — for your own tax filing €15.74 Below is a detailed list of all bookings made for your tours this period.`

function row(items: [string, number, number][]): PositionedText[] {
  return items.map(([str, x, y]) => ({ str, x, y }))
}

// Two synthetic rows, the second with a wrapped cruise name, followed by a
// page-footer marker (as would appear at the bottom of page 1) then one more
// row (as would appear at the top of page 2, no header repeated).
const TABLE_ITEMS: PositionedText[] = [
  ...row([
    ['DATE', 48, 247], ['GUEST', 93, 247], ['GUESTS', 188, 247], ['CRUISE', 223, 247],
    ['TOTAL', 388, 247], ['EX VAT', 451, 247], ['INCL. VAT', 512, 247],
  ]),
  ...row([
    ['2 Apr', 48, 221], ['Jane Doe', 93, 221], ['6', 200, 221],
    ['Cruise with a local – 90 minutes –', 223, 221], ['Thingstodo favourite!', 223, 211],
    ['€150.00', 381, 221], ['€27.52', 450, 221], ['€33.30', 521, 221],
  ]),
  ...row([
    ['5 Apr', 48, 187], ['John Smith', 93, 187], ['4', 200, 187],
    ['Shared Off The Beaten Path, Hid-', 223, 187], ['den Gems Canal Cruise', 223, 178],
    ['€140.00', 381, 187], ['€25.69', 450, 187], ['€31.08', 521, 187],
  ]),
  { str: 'Boat Local · KVK 65990190 · BTW NL000000000B00', x: 40, y: 22 },
  // The invoice-number footer text sits right next to the KVK line, on the
  // same row — this is exactly what leaked into the previous row (John
  // Smith's) and clobbered its EX VAT with 0 before the footer-state fix.
  { str: 'Invoice BL-2026-06-OP-0008', x: 458, y: 22 },
  // page 2 continuation — no header row repeats
  ...row([
    ['11 Apr', 48, 797], ['Alex Tester', 93, 797], ['1', 200, 797],
    ['Private Off The Beaten Path, Hid-', 223, 797], ['den Gems Canal Cruise', 223, 788],
    ['€310.00', 381, 797], ['€56.88', 450, 797], ['€68.82', 521, 797],
  ]),
  { str: 'Boat Local · KVK 65990190 · BTW NL000000000B00', x: 40, y: 22 },
  { str: 'Invoice BL-2026-06-OP-0008', x: 458, y: 22 },
]

describe('parseBoatLocalSummaryText', () => {
  it('extracts invoice number, dates and the full VAT breakdown', () => {
    const summary = parseBoatLocalSummaryText(SUMMARY_TEXT)
    expect(summary).toEqual({
      invoiceNumber: 'BL-2026-06-OP-0008',
      issueDate: '2026-07-08',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      totalSalesInclVatCents: 24500,
      totalSalesExclVatCents: 22477,
      commissionExVatCents: 4495,
      vat21Cents: 944,
      totalWithheldCents: 5439,
      operatorPayoutCents: 19061,
      vat9InPayoutCents: 1574,
    })
  })

  it('does not confuse "Operator Payout" with the "...inside Operator Payout" VAT line', () => {
    const summary = parseBoatLocalSummaryText(SUMMARY_TEXT)
    expect(summary.operatorPayoutCents).toBe(19061)
    expect(summary.vat9InPayoutCents).toBe(1574)
  })
})

describe('parseBoatLocalLines', () => {
  it('reconstructs rows from position data, skipping the header and footer', () => {
    const lines = parseBoatLocalLines(TABLE_ITEMS, 2026)
    expect(lines).toHaveLength(3)
  })

  it('parses guest, guest count and amounts for a simple row', () => {
    const lines = parseBoatLocalLines(TABLE_ITEMS, 2026)
    expect(lines[0]).toEqual({
      bookingDate: '2026-04-02',
      guestName: 'Jane Doe',
      guestCount: 6,
      cruiseName: 'Cruise with a local – 90 minutes – Thingstodo favourite!',
      totalCents: 15000,
      exVatCents: 2752,
      inclVatCents: 3330,
    })
  })

  it('dehyphenates a cruise name wrapped across two lines', () => {
    const lines = parseBoatLocalLines(TABLE_ITEMS, 2026)
    expect(lines[1].cruiseName).toBe('Shared Off The Beaten Path, Hidden Gems Canal Cruise')
  })

  it('does not let the "Invoice BL-..." footer text (same row as the KVK line) clobber the row right before it', () => {
    // Regression: the footer marker check only skipped the KVK line itself;
    // the adjacent invoice-number text fell through into the PREVIOUS row's
    // item list and landed in the EX VAT bucket by x-position, overwriting
    // the real value with 0 (NaN parse of "Invoice BL-..." -> 0).
    const lines = parseBoatLocalLines(TABLE_ITEMS, 2026)
    expect(lines[1]).toMatchObject({ guestName: 'John Smith', exVatCents: 2569, inclVatCents: 3108 })
    expect(lines[2]).toMatchObject({ guestName: 'Alex Tester', exVatCents: 5688, inclVatCents: 6882 })
  })

  it('continues parsing rows past a page-footer marker (page 2, no repeated header)', () => {
    const lines = parseBoatLocalLines(TABLE_ITEMS, 2026)
    expect(lines[2]).toMatchObject({ bookingDate: '2026-04-11', guestName: 'Alex Tester', guestCount: 1 })
  })

  it('returns an empty array when no date-anchored rows are found', () => {
    expect(parseBoatLocalLines([{ str: 'nothing here', x: 0, y: 0 }], 2026)).toEqual([])
  })
})

describe('parseBoatLocalPayoutPdf', () => {
  // 30s: generates a real PDF with pdf-lib and parses it back through pdfjs.
  // Both are genuinely slow (~2-4s) and slower still under the full suite's
  // parallel CPU load — the default 5s is not enough headroom.
  it('parses a real PDF end-to-end through pdfjs (synthetic fixture, not a real payout document)', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([600, 850])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const words = SUMMARY_TEXT.split(' ').filter(Boolean)
    // Lay the summary text out as a simple word-wrapped block — good enough
    // to prove the pdfjs plumbing works; row reconstruction is covered above.
    let x = 20, y = 820
    for (const word of words) {
      if (x > 550) { x = 20; y -= 14 }
      page.drawText(word, { x, y, size: 8, font })
      x += word.length * 5 + 6
    }
    const buffer = Buffer.from(await pdf.save())

    const payout = await parseBoatLocalPayoutPdf(buffer)
    expect(payout.invoiceNumber).toBe('BL-2026-06-OP-0008')
    expect(payout.operatorPayoutCents).toBe(19061)
  }, 30_000)
})
