// Parses the "Merchant reconciliation statement" CSV export from the
// Revolut Business dashboard for Rederij Zoomers & Schenk's EUR Merchant
// account — the payment-link channel used for direct sales (cruise
// bookings, onboard drinks, merch) that don't go through the main website's
// Stripe checkout. Two row types matter:
//   - "Settlement" — one customer payment (what actually needs a VAT split)
//   - "Transfer" — "Merchant payout to an internal account", money moving
//     from the Revolut balance to the bank. Not stored as its own row, but
//     its date IS what determines when each settlement actually got paid
//     out — see below.
//
// Unlike every other kasboek source's CSV, this export can contain a quoted
// field with an embedded literal newline (a multi-line order description,
// e.g. "- 2 prosecco\n- 1 water") — a naive split-by-line-then-by-comma
// parser corrupts that row. This parser tracks quote state across the whole
// file instead of per line.
//
// A settlement's own date is when the CUSTOMER paid — not when Revolut
// actually transferred that money to the bank. Revolut accumulates
// settlements into a running balance and periodically sweeps it to zero
// with a Transfer; every settlement since the last Transfer gets paid out
// together, on the Transfer's date. So `payoutDate` is derived by replaying
// the balance mechanism: walk every row in chronological order, and when a
// Transfer occurs, stamp its date onto every settlement collected since the
// previous Transfer. A settlement with no Transfer after it yet (still
// sitting in the Revolut balance) gets `payoutDate: null` — genuinely not
// yet paid out, not a data gap.

import { parseCsvRows, toCents as sharedToCents } from './shared'

export interface RevolutSettlementRow {
  transactionId: string
  occurredAt: string | null // "YYYY-MM-DD", when the customer paid — NOT the payout date
  payoutDate: string | null // "YYYY-MM-DD", when Revolut actually transferred this to the bank; null if not yet paid out
  description: string | null // Order description, falling back to Description
  customerName: string | null
  originalAmountCents: number // gross — what the customer actually paid
  settlementAmountCents: number // net of Revolut's own processing fee
  processingFeeCents: number // Revolut's own fee, stored positive (a cost)
}

// Unparseable → 0 (this source's own values are always plain numbers; the
// canonical toCents returns null on failure so a bad row is never silently
// treated as a real zero elsewhere).
function toCents(value: string | undefined): number {
  return sharedToCents(value) ?? 0
}

// "2025-08-20 15:03:17.394276" -> "2025-08-20"
function toDateOnly(value: string | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((value ?? '').trim())
  return m ? m[1] : null
}

export function parseRevolutStatementCsv(csvText: string): RevolutSettlementRow[] {
  const rows = parseCsvRows(csvText)
  if (rows.length < 2) return []

  const header = rows[0].map(h => h.trim())
  const col = (name: string) => header.findIndex(h => h === name)
  const idx = {
    started: col('Date & Time Started (UTC)'),
    completed: col('Date & Time Completed (UTC)'),
    type: col('Type'),
    description: col('Description'),
    orderDescription: col('Order description'),
    customerName: col('Customer name'),
    originalAmount: col('Original amount'),
    settlementAmount: col('Settlement amount'),
    processingFee: col('Processing fee'),
    transactionId: col('Transaction ID'),
  }

  // First pass: collect every row (settlement or transfer) with its
  // COMPLETED timestamp — a settlement typically completes ~24h after it
  // starts (confirmed against real data: a settlement that starts 16:25 and
  // completes the next day 16:26 is only included in a Transfer that
  // happens AFTER that completion, never one that happens in between).
  // Sorting by "Started" instead silently misassigns which Transfer a
  // settlement's money actually went out in — verified against all 7 real
  // transfers in the account history, this is the only ordering that
  // reproduces every one exactly. Transfers complete essentially instantly
  // (Started ≈ Completed), so this doesn't affect their own dates.
  type RawRow = { timestamp: string; startedAt: string; type: string; fields: string[] }
  const raw: RawRow[] = []
  for (const fields of rows.slice(1)) {
    const type = fields[idx.type]?.trim()
    const startedAt = fields[idx.started]?.trim()
    const timestamp = fields[idx.completed]?.trim() || startedAt
    if (!type || !timestamp) continue
    raw.push({ timestamp, startedAt, type, fields })
  }
  raw.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  // Second pass: replay the balance — accumulate settlements since the last
  // Transfer (by completion time), and stamp the Transfer's date onto all
  // of them when it occurs.
  const settlements: RevolutSettlementRow[] = []
  let pending: RevolutSettlementRow[] = []

  for (const { type, fields, timestamp, startedAt } of raw) {
    if (type === 'Transfer') {
      const payoutDate = toDateOnly(timestamp)
      for (const s of pending) s.payoutDate = payoutDate
      pending = []
      continue
    }
    if (type !== 'Settlement') continue

    const transactionId = fields[idx.transactionId]?.trim()
    if (!transactionId) continue

    const orderDescription = fields[idx.orderDescription]?.trim()
    const description = fields[idx.description]?.trim()

    const row: RevolutSettlementRow = {
      transactionId,
      occurredAt: toDateOnly(startedAt), // when the customer paid, not when it completed/paid out
      payoutDate: null, // filled in when (if) the next Transfer sweeps it
      description: orderDescription || description || null,
      customerName: fields[idx.customerName]?.trim() || null,
      originalAmountCents: toCents(fields[idx.originalAmount]),
      settlementAmountCents: toCents(fields[idx.settlementAmount]),
      processingFeeCents: Math.abs(toCents(fields[idx.processingFee])),
    }
    settlements.push(row)
    pending.push(row)
  }

  return settlements
}

// Free-text order descriptions mix cruise bookings (9%) and onboard drinks/
// merch (21%) with no structured line items at all — a real transaction
// ("Anniversary 17-06-2026 drinks+charcuterie", confirmed 9% by Beer despite
// the drinks/charcuterie wording) already proved a single-keyword match can
// be wrong. So this is a SUGGESTION for the classify UI to pre-fill, never
// something the upload route writes as final — every transaction still
// needs a human to confirm the split before it counts toward VAT-owed.
const CRUISE_PATTERNS = [/\btour\b/i, /\bsail\b/i, /\bcruise\b/i, /\btochtje\b/i, /\bvaartocht\b/i, /\bcharter\b/i]
const EXTRAS_PATTERNS = [/\bdrank/i, /\bdrink/i, /\bwine\b/i, /\bsnack/i, /\bmerch\b/i, /t[-\s]?shirts?/i, /\bbites\b/i, /corkage|corckage/i, /charcuterie/i]

/**
 * Suggests a 100%-cruise or 100%-extras split when the description matches
 * ONLY one side unambiguously. Returns null (no suggestion — matches both,
 * or neither) whenever the description doesn't clearly settle it, which the
 * classify UI should show as "needs your input" rather than pre-filling.
 */
export function guessRevolutVatSplit(
  description: string | null,
  originalAmountCents: number
): { vat9GrossCents: number; vat21GrossCents: number } | null {
  const text = description ?? ''
  const isCruise = CRUISE_PATTERNS.some(p => p.test(text))
  const isExtras = EXTRAS_PATTERNS.some(p => p.test(text))
  if (isCruise && !isExtras) return { vat9GrossCents: originalAmountCents, vat21GrossCents: 0 }
  if (isExtras && !isCruise) return { vat9GrossCents: 0, vat21GrossCents: originalAmountCents }
  return null
}
