// Parses the "Download the summary" CSV export from
// clickandboat.com/en/account/bookings — one row per booking, covering the
// full history every time (not incremental), so re-uploading is a safe
// no-op for bookings already stored (upsert by charter number).

import { parseCsvRows, toCents as sharedToCents } from './shared'

export interface ClickAndBoatBookingRow {
  charterNumber: string
  listingTitle: string | null
  startDate: string | null // "YYYY-MM-DD"
  endDate: string | null // "YYYY-MM-DD"
  durationDays: number | null
  grossAmountCents: number
  netAmountCents: number
  bankTransferDate: string | null // "YYYY-MM-DD"
  location: string | null
}

// "20-07-2025" -> "2025-07-20"
function parseDdMmYyyy(value: string | undefined): string | null {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec((value ?? '').trim())
  if (!m) return null
  const [, dd, mm, yyyy] = m
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

// Unparseable → 0 (the canonical toCents returns null on failure; this source's
// call sites expect a plain number).
function toCents(value: string | undefined): number {
  return sharedToCents(value) ?? 0
}

export function parseClickAndBoatCsv(csvText: string): ClickAndBoatBookingRow[] {
  const rows = parseCsvRows(csvText)
  if (rows.length < 2) return []

  const header = rows[0].map(h => h.trim())
  const col = (name: string) => header.findIndex(h => h === name)
  const idx = {
    charterNumber: col('No. charter'),
    listingTitle: col('Listing title'),
    startDate: col('Charter start date'),
    endDate: col('Charter end date'),
    duration: col('Duration (days)'),
    gross: col('Gross amount (€)'),
    net: col('Net amount (€)'),
    bankTransfer: col('Bank transfer'),
    location: col('Location'),
  }

  const bookingRows: ClickAndBoatBookingRow[] = []
  for (const fields of rows.slice(1)) {
    const charterNumber = fields[idx.charterNumber]?.trim()
    if (!charterNumber) continue
    bookingRows.push({
      charterNumber,
      listingTitle: fields[idx.listingTitle]?.trim() || null,
      startDate: parseDdMmYyyy(fields[idx.startDate]),
      endDate: parseDdMmYyyy(fields[idx.endDate]),
      durationDays: idx.duration !== -1 ? (parseFloat(fields[idx.duration]) || null) : null,
      grossAmountCents: toCents(fields[idx.gross]),
      netAmountCents: toCents(fields[idx.net]),
      bankTransferDate: parseDdMmYyyy(fields[idx.bankTransfer]),
      location: fields[idx.location]?.trim() || null,
    })
  }
  return bookingRows
}
