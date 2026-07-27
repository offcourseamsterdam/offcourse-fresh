// Parses a Withlocals "New payout" email. Unlike the per-booking invoice,
// the payout email has NO attachment — it's an HTML table in the body listing
// every booking rolled into that month's payout, plus the headline total in
// the subject/intro. It's the bank-reconciliation side of Withlocals: the
// total here must match the deposit that lands in the bank, and it tells us
// WHEN each booking was actually paid (the invoice only says the booking was
// invoiced, not when the money moved).
//
// Input is the flattened visible text of the email (from the browser's
// get_page_text), so this parser works on plain text, not a PDF.

import { toCents as sharedToCents } from './shared'

export interface WithlocalsPayoutLine {
  tripAt: string | null // as printed, e.g. "Sunday, June 21, 2026 at 15:00"
  bookingId: string | null // 8-char short id as shown in the payout table
  guest: string | null
  amountCents: number // net paid out for this booking
}

export interface WithlocalsPayout {
  totalCents: number | null // headline "New payout of €X"
  lines: WithlocalsPayoutLine[]
  linesTotalCents: number // sum of line amounts — should equal totalCents
}

// Unparseable → 0 (the canonical toCents returns null on failure; this source's
// call sites expect a plain number).
function toCents(value: string): number {
  return sharedToCents(value) ?? 0
}

/**
 * Pulls the payout total and the per-booking lines out of the email text.
 * The table repeats a "Trip date & time / Booking ID / Guest / Amount" header
 * before every row; each data row is:
 *   <trip date & time> <8-hex booking id> <guest> €<amount>
 */
export function parseWithlocalsPayoutText(rawText: string): WithlocalsPayout {
  const text = rawText.replace(/\r/g, '')

  const totalMatch = /payout of\s*€\s*([\d,.]+)/i.exec(text)
  const totalCents = totalMatch ? toCents(totalMatch[1]) : null

  const lines: WithlocalsPayoutLine[] = []
  // Each row: "<trip...> <bookingId> <guest> €<amount>" — the booking id is an
  // 8-char hex token, which anchors the row and separates trip from guest.
  const rowRe = /([A-Za-z]+day,[^\n]*?)\s+([0-9a-f]{8})\s+(.+?)\s+€\s*([\d,.]+)/g
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(text))) {
    lines.push({
      tripAt: m[1].trim(),
      bookingId: m[2],
      guest: m[3].trim(),
      amountCents: toCents(m[4]),
    })
  }

  const linesTotalCents = lines.reduce((s, l) => s + l.amountCents, 0)
  return { totalCents, lines, linesTotalCents }
}
