import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import { extractVat } from '@/lib/extras/calculate'
import { CITY_TAX_CENTS_PER_GUEST, CRUISE_VAT_RATE, EXTRAS_VAT_RATE } from '@/lib/booking/constants'

// ── Company details ────────────────────────────────────────────────────────────

const COMPANY = {
  name:    'Rederij Zoomers & Schenk',
  address: 'Herenmarkt 93 A',
  city:    '1013 EC Amsterdam, Netherlands',
  kvk:     '97275611',
  btw:     'NL867981374B01',
  email:   'cruise@offcourseamsterdam.com',
}

// ── Colors ────────────────────────────────────────────────────────────────────

const C_INDIGO     = rgb(0.118, 0.106, 0.294) // #1e1b4b
const C_GRAY       = rgb(0.44, 0.44, 0.47)
const C_BLACK      = rgb(0, 0, 0)
const C_LINE       = rgb(0.87, 0.87, 0.87)
const C_ROW_ALT    = rgb(0.97, 0.97, 0.97)
const C_WHITE      = rgb(1, 1, 1)

// ── Layout constants ──────────────────────────────────────────────────────────

const PAGE_W = 595.28  // A4
const PAGE_H = 841.89
const ML     = 50      // left margin
const MR     = 50      // right margin
const CW     = PAGE_W - ML - MR  // content width

const FOOTER_Y = 40               // footer baseline
// Content must never drop below this line — it reserves room for the footer.
// When the running cursor would cross it mid-table, we start a fresh page.
const CONTENT_FLOOR = FOOTER_Y + 30

// Column right-edges for the line-items table (right-aligned amounts)
const COL_RATE_END = ML + CW * 0.63
const COL_NET_END  = ML + CW * 0.76
const COL_VAT_END  = ML + CW * 0.88
const COL_TOT_END  = ML + CW          // = PAGE_W - MR

const ROW_H = 17

// ── Public interface ──────────────────────────────────────────────────────────

export interface InvoiceInput {
  /** e.g. "OC-F77B627B" */
  invoiceNumber: string
  /** e.g. "27 June 2026" */
  invoiceDate: string
  customerName: string
  customerEmail: string
  listingTitle: string
  /** e.g. "2026-06-30" */
  bookingDate: string
  guestCount: number
  /** Cruise price inclusive of 9% Dutch VAT, BEFORE any discount. */
  baseAmountCents: number
  /** Individual extras — each shown as a separate line at 21% VAT. */
  extrasSelected: Array<{ name: string; amount_cents: number }>
  /** Amsterdam city tax actually charged (0% VAT). Falls back to guestCount × rate. */
  cityTaxCents?: number | null
  /** Promo/discount applied to the cruise fare, inclusive of its 9% VAT. */
  discountAmountCents?: number | null
  fhBookingUuid?: string | null
  stripePaymentIntentId?: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtEur(cents: number): string {
  return `EUR ${(cents / 100).toFixed(2)}`
}

function fmtDate(isoOrPlain: string): string {
  // Accepts "2026-06-30" or "June 30, 2026" etc — normalize to "30 Jun 2026".
  // Pin the timezone so a date-only string (parsed as UTC midnight) can't render
  // as the previous day on a server west of UTC.
  try {
    const d = new Date(isoOrPlain)
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Amsterdam',
      })
    }
  } catch { /* fall through */ }
  return isoOrPlain
}

/**
 * pdf-lib's StandardFonts are WinAnsi-encoded — drawing any character outside
 * that set (emoji, CJK, Cyrillic, some smart punctuation) THROWS and would abort
 * the whole invoice. Customer names, listing titles and extra names are
 * arbitrary input (we support a `zh` locale), so normalise everything to a safe
 * WinAnsi-renderable form before it ever reaches drawText.
 */
const WINANSI_REPLACEMENTS: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"',
  '–': '-', '—': '-', '−': '-',
  '…': '...', ' ': ' ', ' ': ' ', ' ': ' ',
}
function wa(input: string | null | undefined): string {
  if (input == null) return ''
  let s = String(input)
  for (const [from, to] of Object.entries(WINANSI_REPLACEMENTS)) {
    s = s.split(from).join(to)
  }
  // Strip anything still outside the printable WinAnsi range. WinAnsi covers
  // Latin-1 (0x20–0xFF minus a few control slots); we keep it simple and drop
  // any code point above 0xFF that we didn't explicitly map above.
  return s.replace(/[^\x20-\xFF]/g, '').trim() || ''
}

function ra(page: PDFPage, text: string, rightX: number, y: number, size: number, font: PDFFont, color: typeof C_BLACK) {
  const safe = wa(text)
  const w = font.widthOfTextAtSize(safe, size)
  page.drawText(safe, { x: rightX - w, y, size, font, color })
}

function la(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color: typeof C_BLACK) {
  page.drawText(wa(text), { x, y, size, font, color })
}

function truncate(s: string, maxLen: number): string {
  const safe = wa(s)
  return safe.length > maxLen ? safe.slice(0, maxLen - 1) + '...' : safe
}

/** Exported for tests — same sanitiser used before any text reaches the PDF. */
export const sanitizeForPdf = wa

export interface InvoiceLine { desc: string; amountIncl: number; vatRate: number }
export interface InvoiceTotals {
  lines: InvoiceLine[]
  totalNet: number
  totalVat: number
  totalIncl: number
  vatByRate: Map<number, { net: number; vat: number }>
}

/**
 * Pure money layer: turn an invoice input into line items + reconciled totals.
 * The discount is a negative line at the cruise VAT rate, so `totalIncl` always
 * equals base + extras + cityTax − discount (i.e. the amount actually charged),
 * and `totalNet + totalVat === totalIncl` by construction.
 */
export function buildInvoiceTotals(input: InvoiceInput): InvoiceTotals {
  const cityTaxCents = input.cityTaxCents != null
    ? input.cityTaxCents
    : input.guestCount * CITY_TAX_CENTS_PER_GUEST
  const discountCents = Math.max(0, Math.round(input.discountAmountCents ?? 0))

  const lines: InvoiceLine[] = []
  if (input.baseAmountCents > 0) {
    lines.push({ desc: truncate(input.listingTitle, 52), amountIncl: input.baseAmountCents, vatRate: CRUISE_VAT_RATE })
  }
  for (const e of input.extrasSelected ?? []) {
    if (e && e.amount_cents > 0) {
      lines.push({ desc: truncate(e.name, 52), amountIncl: e.amount_cents, vatRate: EXTRAS_VAT_RATE })
    }
  }
  if (cityTaxCents > 0) {
    lines.push({
      desc: `Amsterdam city tax (${input.guestCount} ${input.guestCount === 1 ? 'person' : 'persons'})`,
      amountIncl: cityTaxCents,
      vatRate: 0,
    })
  }
  if (discountCents > 0) {
    lines.push({ desc: 'Discount', amountIncl: -discountCents, vatRate: CRUISE_VAT_RATE })
  }

  let totalNet = 0, totalVat = 0, totalIncl = 0
  const vatByRate = new Map<number, { net: number; vat: number }>()
  for (const line of lines) {
    const vat = extractVat(line.amountIncl, line.vatRate)
    const net = line.amountIncl - vat
    totalNet += net
    totalVat += vat
    totalIncl += line.amountIncl
    const prev = vatByRate.get(line.vatRate) ?? { net: 0, vat: 0 }
    vatByRate.set(line.vatRate, { net: prev.net + net, vat: prev.vat + vat })
  }
  return { lines, totalNet, totalVat, totalIncl, vatByRate }
}

// ── PDF generator ─────────────────────────────────────────────────────────────

export async function generateInvoicePdf(input: InvoiceInput): Promise<Uint8Array> {
  const doc  = await PDFDocument.create()
  const B    = await doc.embedFont(StandardFonts.HelveticaBold)
  const R    = await doc.embedFont(StandardFonts.Helvetica)

  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - ML  // start near top

  // Footer is drawn on every page once we know how many pages there are.
  const drawFooter = (p: PDFPage) => {
    p.drawLine({ start: { x: ML, y: FOOTER_Y + 14 }, end: { x: PAGE_W - MR, y: FOOTER_Y + 14 }, thickness: 0.5, color: C_LINE })
    const footerText = `${COMPANY.name}  ·  ${COMPANY.address}, ${COMPANY.city}  ·  KVK: ${COMPANY.kvk}  ·  VAT: ${COMPANY.btw}`
    la(p, footerText, ML, FOOTER_Y, 7, R, C_GRAY)
  }

  // Start a new page and reset the cursor when content would hit the footer.
  const ensureSpace = (needed: number) => {
    if (y - needed < CONTENT_FLOOR) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - ML
    }
  }

  // ══ HEADER ════════════════════════════════════════════════════════════════

  la(page, COMPANY.name, ML, y, 14, B, C_INDIGO)
  ra(page, 'INVOICE', COL_TOT_END, y, 20, B, C_INDIGO)

  y -= 18
  la(page, COMPANY.address,          ML, y, 8.5, R, C_GRAY); y -= 12
  la(page, COMPANY.city,             ML, y, 8.5, R, C_GRAY); y -= 12
  la(page, `KVK: ${COMPANY.kvk}`,    ML, y, 8.5, R, C_GRAY); y -= 12
  la(page, `VAT no: ${COMPANY.btw}`, ML, y, 8.5, R, C_GRAY)

  // Invoice meta — right column (aligned with "INVOICE" label)
  const META_KEY_X = COL_TOT_END - 180
  const META_VAL_X = COL_TOT_END
  let metaY = PAGE_H - ML - 20
  const metaRow = (label: string, value: string) => {
    la(page, label, META_KEY_X, metaY, 8.5, R, C_GRAY)
    ra(page, value, META_VAL_X, metaY, 8.5, B, C_BLACK)
    metaY -= 13
  }
  metaRow('Invoice no.', input.invoiceNumber)
  metaRow('Date',        input.invoiceDate)

  y -= 22

  // ── separator ─────────────────────────────────────────────────────────────
  page.drawLine({ start: { x: ML, y }, end: { x: PAGE_W - MR, y }, thickness: 0.75, color: C_LINE })
  y -= 18

  // ══ BILL TO ═══════════════════════════════════════════════════════════════

  la(page, 'BILL TO', ML, y, 7.5, B, C_GRAY); y -= 14
  la(page, input.customerName,  ML, y, 11, B, C_BLACK); y -= 13
  la(page, input.customerEmail, ML, y, 9, R, C_GRAY)

  y -= 24

  page.drawLine({ start: { x: ML, y }, end: { x: PAGE_W - MR, y }, thickness: 0.75, color: C_LINE })
  y -= 18

  // ══ BOOKING DETAILS ════════════════════════════════════════════════════════

  la(page, 'SERVICE / BOOKING', ML, y, 7.5, B, C_GRAY); y -= 14
  la(page, truncate(input.listingTitle, 55), ML, y, 10.5, B, C_BLACK); y -= 13
  la(page, `Date: ${fmtDate(input.bookingDate)}   ·   Guests: ${input.guestCount}`, ML, y, 8.5, R, C_GRAY)
  if (input.fhBookingUuid) {
    y -= 12
    la(page, `Booking ref: ${input.fhBookingUuid}`, ML, y, 8.5, R, C_GRAY)
  }

  y -= 24

  // ══ LINE ITEMS ═════════════════════════════════════════════════════════════

  // Pure money layer (line items + reconciled totals). The discount is a negative
  // line at the cruise VAT rate, so the printed TOTAL DUE always reconciles to the
  // amount the customer was actually charged.
  const { lines, totalNet, totalVat, totalIncl, vatByRate } = buildInvoiceTotals(input)

  // Header row helper (re-drawn at the top of every page the table spills onto)
  const drawTableHeader = () => {
    page.drawRectangle({ x: ML, y: y - 4, width: CW, height: ROW_H, color: C_INDIGO })
    const headerY = y + 2
    la(page, 'Description', ML + 5, headerY, 8, B, C_WHITE)
    ra(page, 'VAT %',     COL_RATE_END, headerY, 8, B, C_WHITE)
    ra(page, 'Excl. VAT', COL_NET_END,  headerY, 8, B, C_WHITE)
    ra(page, 'VAT',       COL_VAT_END,  headerY, 8, B, C_WHITE)
    ra(page, 'Total',     COL_TOT_END,  headerY, 8, B, C_WHITE)
    y -= ROW_H + 4
  }
  drawTableHeader()

  let rowIdx = 0
  for (const line of lines) {
    // Page-break mid-table if we'd run into the footer.
    if (y - ROW_H < CONTENT_FLOOR) {
      drawFooter(page)
      page = doc.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - ML
      drawTableHeader()
      rowIdx = 0
    }
    if (rowIdx % 2 === 1) {
      page.drawRectangle({ x: ML, y: y - 4, width: CW, height: ROW_H, color: C_ROW_ALT })
    }
    const vat = extractVat(line.amountIncl, line.vatRate)
    const net = line.amountIncl - vat

    la(page, line.desc,              ML + 5,       y, 9, R, C_BLACK)
    ra(page, `${line.vatRate}%`,     COL_RATE_END, y, 9, R, C_BLACK)
    ra(page, fmtEur(net),            COL_NET_END,  y, 9, R, C_BLACK)
    ra(page, fmtEur(vat),            COL_VAT_END,  y, 9, R, C_BLACK)
    ra(page, fmtEur(line.amountIncl), COL_TOT_END, y, 9, R, C_BLACK)
    y -= ROW_H
    rowIdx++
  }

  y -= 6
  page.drawLine({ start: { x: ML, y }, end: { x: PAGE_W - MR, y }, thickness: 0.75, color: C_LINE })
  y -= 18

  // ══ VAT SUMMARY ════════════════════════════════════════════════════════════

  const uniqueRates = [...vatByRate.keys()].sort((a, b) => a - b)
  if (uniqueRates.length > 0) {
    ensureSpace(13 + uniqueRates.length * 12 + 8)
    la(page, 'VAT SUMMARY', ML, y, 7.5, B, C_GRAY); y -= 13
    for (const rate of uniqueRates) {
      const { net, vat } = vatByRate.get(rate)!
      la(page, `VAT ${rate}%   base ${fmtEur(net)}   VAT amount ${fmtEur(vat)}`, ML, y, 8.5, R, C_GRAY)
      y -= 12
    }
    y -= 8
  }

  // ══ TOTALS ═════════════════════════════════════════════════════════════════

  ensureSpace(14 * 2 + 4 + 12 + 14 + 24)
  const TOTALS_X = ML + CW * 0.5
  const totRow = (label: string, cents: number, grand = false) => {
    const sz   = grand ? 11 : 9
    const font = grand ? B : R
    const col  = grand ? C_INDIGO : C_GRAY
    la(page, label,           TOTALS_X,    y, sz, font, col)
    ra(page, fmtEur(cents),   COL_TOT_END, y, sz, font, col)
    y -= grand ? 0 : 14
  }

  totRow('Subtotal (excl. VAT)', totalNet)
  totRow('Total VAT',            totalVat)
  y -= 4
  page.drawLine({ start: { x: TOTALS_X, y }, end: { x: COL_TOT_END, y }, thickness: 0.75, color: C_INDIGO })
  y -= 12
  totRow('TOTAL DUE (incl. VAT)', totalIncl, true)
  y -= 24

  // ══ PAYMENT NOTE ══════════════════════════════════════════════════════════

  if (input.stripePaymentIntentId) {
    ensureSpace(12 + 12)
    la(page, 'Payment received. Thank you!', ML, y, 9, B, C_INDIGO); y -= 12
    la(page, `Transaction ref: ${input.stripePaymentIntentId}`, ML, y, 8, R, C_GRAY)
  }

  // ══ FOOTER (every page) ════════════════════════════════════════════════════

  for (const p of doc.getPages()) drawFooter(p)

  return doc.save()
}

// ── Convenience: derive a STABLE invoice number from booking refs ─────────────

export function makeInvoiceNumber(fhBookingUuid?: string | null, stripePaymentIntentId?: string | null): string {
  // Must be deterministic so a resend produces the SAME number for one booking.
  // Prefer the FareHarbor UUID, then the Stripe PI — both are stable per booking.
  if (fhBookingUuid) {
    return `OC-${fhBookingUuid.substring(0, 8).toUpperCase()}`
  }
  if (stripePaymentIntentId) {
    const clean = stripePaymentIntentId.replace('pi_', '').substring(0, 8).toUpperCase()
    return `OC-${clean}`
  }
  // No stable ref at all — last-resort placeholder. Callers always pass at least
  // one ref in practice, so this only guards against a fully-anonymous call.
  return 'OC-PENDING'
}
