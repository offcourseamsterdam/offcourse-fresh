/**
 * The missing-invoice insight (§6, docs/plans/2026-09-04-financial-management-module.md):
 * "shifts with staff_id, end < today − 14d, no finance_invoices.matched_shift_id".
 *
 * A skipper who never sent an invoice for a shift they worked two weeks ago
 * is a real gap Beer should know about — not something to guess a value for
 * (see extract.ts's own "never invent" rule; this is the same principle one
 * step earlier, at "did this even arrive" rather than "what does it say").
 *
 * Pure formatting/date logic here; the cron route (route.ts) does the actual
 * shifts/finance_invoices/staff queries and posts to Slack.
 */

import { addDays, type ISODate } from '../cockpit/dates'

export const MISSING_INVOICE_LOOKBACK_DAYS = 14

export interface MissingInvoiceShift {
  id: string
  staffName: string
  date: ISODate
  boatName: string | null
}

/** Shifts older than this date (exclusive) are old enough to expect an invoice for. */
export function missingInvoiceCutoff(today: ISODate, lookbackDays: number = MISSING_INVOICE_LOOKBACK_DAYS): ISODate {
  return addDays(today, -lookbackDays)
}

const MAX_LISTED = 20

/** '' when there's nothing to report — the caller skips posting entirely rather than sending an empty/trivial Slack message. */
export function formatMissingInvoicesMessage(shifts: MissingInvoiceShift[]): string {
  if (shifts.length === 0) return ''
  const lines = shifts.slice(0, MAX_LISTED).map(s => `• ${s.staffName} — ${s.date}${s.boatName ? ` (${s.boatName})` : ''}`)
  const overflow = shifts.length - MAX_LISTED
  const more = overflow > 0 ? `\n…en nog ${overflow} meer` : ''
  return `📋 *${shifts.length} dienst${shifts.length === 1 ? '' : 'en'} zonder factuur* (langer dan ${MISSING_INVOICE_LOOKBACK_DAYS} dagen geleden):\n${lines.join('\n')}${more}`
}
