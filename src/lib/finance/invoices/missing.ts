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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { addDays, type ISODate } from '../cockpit/dates'

type Admin = SupabaseClient<Database>

export const MISSING_INVOICE_LOOKBACK_DAYS = 14
/**
 * How far past the cutoff to look. A shift older than this either got its
 * invoice months ago or is a write-off nobody is going to chase — without a
 * floor this scanned every shift ever worked, plus one `.in()` of every id,
 * on every call (the weekly cron AND, since 2026-09-04, the dashboard's
 * "Wat vraagt aandacht?" card).
 */
export const SCAN_WINDOW_DAYS = 90

export interface MissingInvoiceShift {
  id: string
  staffName: string
  date: ISODate
  boatName: string | null
}

/** One shift in the scan window, before staff/boat names are joined in — the raw shape both callers below start from. */
export interface MissingInvoiceCandidate {
  id: string
  staffId: string | null
  boatId: string | null
  date: ISODate
  hasInvoice: boolean
}

/** Shifts older than this date (exclusive) are old enough to expect an invoice for. */
export function missingInvoiceCutoff(today: ISODate, lookbackDays: number = MISSING_INVOICE_LOOKBACK_DAYS): ISODate {
  return addDays(today, -lookbackDays)
}

/**
 * The core query behind the missing-invoice insight, shared by the weekly
 * Slack cron (which names the missing ones and also reports how many it
 * looked at) and the dashboard's live count (which only needs the missing
 * ones). Every candidate in the scan window comes back, `hasInvoice` flagged,
 * so neither caller has to re-derive "how many did we even check". Bounded
 * to [cutoff − SCAN_WINDOW_DAYS, cutoff) so neither caller ever scans this
 * company's entire shift history.
 */
export async function findShiftsMissingInvoices(supabase: Admin, today: ISODate): Promise<MissingInvoiceCandidate[]> {
  const cutoff = missingInvoiceCutoff(today)

  const { data: shifts, error: shiftsErr } = await supabase
    .from('shifts')
    .select('id, staff_id, boat_id, date')
    .not('staff_id', 'is', null)
    .neq('status', 'cancelled')
    .lt('date', cutoff)
    .gte('date', addDays(cutoff, -SCAN_WINDOW_DAYS))
  if (shiftsErr) throw new Error(shiftsErr.message)
  if (!shifts?.length) return []

  const shiftIds = shifts.map(s => s.id)
  const { data: matched, error: matchedErr } = await supabase.from('finance_invoices').select('matched_shift_id').in('matched_shift_id', shiftIds)
  if (matchedErr) throw new Error(matchedErr.message)
  const matchedIds = new Set((matched ?? []).map(m => m.matched_shift_id))

  return shifts.map(s => ({ id: s.id, staffId: s.staff_id, boatId: s.boat_id, date: s.date, hasInvoice: matchedIds.has(s.id) }))
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
