// Parses a Getmyboat "Getmyboat has sent you money" email. No attachment —
// like Withlocals' payout side, it's plain visible text listing every
// booking rolled into that payout, each already carrying its own exact
// numeric booking id (no fuzzy prefix matching needed, unlike Withlocals).
//
// Input is the flattened visible text of the email (from the browser's
// get_page_text), so this parser works on plain text, not a PDF.
//
// A real example (names changed):
//   Your payout of €641.25 EUR is on the way
//   ...
//   TRANSACTIONS INCLUDED:
//
//   5367603
//   Fri, 22 May 2026, Paige Krul
//   €299.25 EUR
//
//   Base Cost €299.25 EUR
//   5680543
//   Sat, 23 May 2026, Dmitrii Tiunkin
//   €342.00 EUR
//
//   Base Cost €342.00 EUR
//
// "Base Cost" here just repeats the same net figure per line (confirmed
// against the "Booking Confirmed!" email, where Base Cost/Service Fee/Payout
// are three DIFFERENT numbers) — this payout email never states the gross
// Base Cost, only the net payout, so there's nothing extra to extract from
// that second line.

import { toCents as sharedToCents } from './shared'

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

export interface GetMyBoatPayoutLine {
  bookingId: string
  charterDate: string | null // "YYYY-MM-DD"
  guest: string | null
  amountCents: number
}

export interface GetMyBoatPayout {
  totalCents: number | null // headline "Your payout of €X EUR is on the way"
  lines: GetMyBoatPayoutLine[]
  linesTotalCents: number // sum of line amounts — should equal totalCents
}

// Unparseable → 0 (the canonical toCents returns null on failure; this source's
// call sites expect a plain number).
function toCents(value: string): number {
  return sharedToCents(value) ?? 0
}

// "Fri, 22 May 2026" -> "2026-05-22"
function parseCharterDate(value: string): string | null {
  const m = /[A-Za-z]{3},?\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(value)
  if (!m) return null
  const [, day, monAbbr, year] = m
  const month = MONTHS[monAbbr]
  if (!month) return null
  return `${year}-${month}-${day.padStart(2, '0')}`
}

/**
 * Pulls the payout total and per-booking lines out of the payout email
 * text. Each row is a numeric booking id on its own line, followed by
 * "<Weekday>, <day> <Mon> <year>, <guest>", followed by "€<amount> EUR" —
 * the booking id anchors the row (5+ digits, on its own line, is never
 * ambiguous with anything else in this email).
 */
export function parseGetMyBoatPayoutText(rawText: string): GetMyBoatPayout {
  const text = rawText.replace(/\r/g, '')

  const totalMatch = /payout of\s*€\s*([\d,.]+)/i.exec(text)
  const totalCents = totalMatch ? toCents(totalMatch[1]) : null

  const lines: GetMyBoatPayoutLine[] = []
  const rowRe = /(\d{5,8})\s*\n\s*([A-Za-z]{3},\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{4}),\s*([^\n]+?)\s*\n\s*€\s*([\d,.]+)\s*EUR/g
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(text))) {
    lines.push({
      bookingId: m[1],
      charterDate: parseCharterDate(m[2]),
      guest: m[3].trim(),
      amountCents: toCents(m[4]),
    })
  }

  const linesTotalCents = lines.reduce((s, l) => s + l.amountCents, 0)
  return { totalCents, lines, linesTotalCents }
}
