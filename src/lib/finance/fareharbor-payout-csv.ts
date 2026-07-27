// Parses FareHarbor's "Sales-Payout Reconciliation" advanced report export
// (fareharbor.com/offcourse/dashboard/reports/advanced/payments-and-refunds/)
// — Detailed report, grouped by Payout ID, with the "Payout Date" column
// added. The Summary report computes clean per-payout totals but exposes no
// date at all (Payout Date isn't a summarizable column), so this reads the
// per-payment detail rows instead and aggregates them by Payout ID itself —
// same totals FareHarbor's own Summary report would show, just with a real
// date attached to each payout.
//
// Historical only: FareHarbor processed payments directly (and paid Off
// Course out under the bank descriptor "FHOFFCOURSE") only until the site's
// native Stripe checkout went live in early May 2026. Nothing new lands here.

import { parseCsvRows, toCents as sharedToCents } from './shared'

export interface FareHarborPayoutRow {
  payoutId: string // no "#" prefix
  payoutDate: string | null // "YYYY-MM-DD"
  grossCents: number
  processingFeeCents: number
  netCents: number
  subtotalPaidCents: number
  vat9Cents: number
  vat21Cents: number
  taxPaidCents: number
  lineCount: number
}

// Unparseable → 0 (the canonical toCents returns null on failure; this source's
// call sites expect a plain number).
function toCents(value: string | undefined): number {
  return sharedToCents(value) ?? 0
}

export function parseFareHarborPayoutCsv(csvText: string): FareHarborPayoutRow[] {
  const rows = parseCsvRows(csvText)
  if (rows.length < 2) return []

  // FareHarbor's export has a title row above the real header — find the
  // row that actually contains "Payout ID" as a column name.
  const headerIdx = rows.findIndex(r => r.includes('Payout ID'))
  if (headerIdx === -1) return []
  const header = rows[headerIdx].map(h => h.trim())

  // "Payout ID" appears twice (once at the start of the row, once again
  // next to "Payout Date" further along) — use the second occurrence for
  // the date lookup, and the first column for grouping.
  const payoutDateCol = header.indexOf('Payout Date')
  const col = (name: string) => header.indexOf(name)
  const idx = {
    gross: col('Gross'),
    processingFee: col('Processing Fee'),
    net: col('Net'),
    subtotalPaid: col('Subtotal Paid'),
    vat9: col('BTW Laag (9%) Paid'),
    vat21: col('BTW Hoog (21%) Paid'),
    taxPaid: col('Tax Paid'),
  }

  const byPayout = new Map<string, FareHarborPayoutRow>()

  for (const fields of rows.slice(headerIdx + 1)) {
    const rawPayoutId = fields[0]?.trim()
    if (!rawPayoutId || !rawPayoutId.startsWith('#')) continue // skip the blank-Payout-ID bucket and total rows
    const payoutId = rawPayoutId.replace(/^#/, '')

    const agg = byPayout.get(payoutId) ?? {
      payoutId,
      payoutDate: payoutDateCol !== -1 ? (fields[payoutDateCol]?.trim() || null) : null,
      grossCents: 0, processingFeeCents: 0, netCents: 0, subtotalPaidCents: 0,
      vat9Cents: 0, vat21Cents: 0, taxPaidCents: 0, lineCount: 0,
    }
    agg.grossCents += toCents(fields[idx.gross])
    agg.processingFeeCents += toCents(fields[idx.processingFee])
    agg.netCents += toCents(fields[idx.net])
    agg.subtotalPaidCents += toCents(fields[idx.subtotalPaid])
    agg.vat9Cents += toCents(fields[idx.vat9])
    agg.vat21Cents += toCents(fields[idx.vat21])
    agg.taxPaidCents += toCents(fields[idx.taxPaid])
    agg.lineCount += 1
    if (!agg.payoutDate && payoutDateCol !== -1) {
      agg.payoutDate = fields[payoutDateCol]?.trim() || null
    }
    byPayout.set(payoutId, agg)
  }

  return [...byPayout.values()]
}
