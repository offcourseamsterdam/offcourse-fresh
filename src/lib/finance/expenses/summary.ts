/**
 * The numbers above the Uitgaven list (plan §6.1, PRD §10): how many records
 * sit in each status, and the VAT position per quarter — what we can reclaim
 * on purchases (voorbelasting, from Expense Records) against what we owe on
 * sales (from the existing BTW dashboard). Two directions, one net figure.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeBtwDashboard } from '@/lib/finance/btw-dashboard-calculator'
import type { QuarterBtwDashboard } from '@/lib/finance/btw-dashboard'
import { currentQuarter, previousQuarters, quarterFromDate, quarterLabel, quarterRange } from '@/lib/quarters'
import { EXPENSE_STATUSES, OPEN_STATUSES, type ExpenseStatus } from './status'

export interface ExpenseSummaryRow {
  status: string
  vat_cents: number | null
  vat_source: string | null
  vat_conflict: unknown
  bank_transaction_id: string | null
  paid_at: string | null
  invoice_date: string | null
  created_at: string
}

export interface VatQuarterPosition {
  quarter: string
  label: string
  /** Voorbelasting: VAT on purchases we can reclaim — only where a cost document (invoice/bon) is matched; no document, no deduction. */
  reclaimableCents: number
  /** VAT we know about (e.g. Revolut's rate) on payments that still lack an invoice/bon — not deductible yet. */
  pendingCents: number
  /** Net VAT owed on sales for the quarter, per the BTW dashboard (owed minus its own deductibles). */
  payableCents: number | null
  /** payable − reclaimable; positive = we pay, negative = we get back. Null when the payable side is unknown. */
  positionCents: number | null
  /** Payments in this quarter whose VAT is still unknown — the reclaimable figure is a floor until these are resolved. */
  unresolvedCount: number
  conflictCount: number
}

export interface ExpenseSummary {
  counts: Record<ExpenseStatus, number>
  open: number
  vat: VatQuarterPosition[]
}

/** Which quarter a payment belongs to for VAT: when the money left, else the invoice date, else when we first saw it. */
export function vatQuarterOf(row: Pick<ExpenseSummaryRow, 'paid_at' | 'invoice_date' | 'created_at'>): string {
  return quarterFromDate(row.paid_at ?? row.invoice_date ?? row.created_at)
}

/** A cost document is attached (and, past 'matched', accepted): the VAT on it is voorbelasting. */
const DEDUCTIBLE_STATUSES = new Set<string>(['matched', 'ready_for_snelstart', 'sent_to_snelstart', 'booked'])

export function summarizeExpenses(rows: ExpenseSummaryRow[], btwQuarters: QuarterBtwDashboard[] | null, today: Date = new Date()): ExpenseSummary {
  const counts = Object.fromEntries(EXPENSE_STATUSES.map(s => [s, 0])) as Record<ExpenseStatus, number>
  for (const r of rows) if (r.status in counts) counts[r.status as ExpenseStatus]++
  const open = OPEN_STATUSES.reduce((n, s) => n + counts[s], 0)

  const quarters = [currentQuarter(today), ...previousQuarters(1, today)]
  const vat = quarters.map<VatQuarterPosition>(quarter => {
    const inQuarter = rows.filter(r => r.status !== 'ignored' && vatQuarterOf(r) === quarter)
    const known = inQuarter.filter(r => r.vat_source && r.vat_cents != null && r.vat_conflict == null)
    // Dutch rule: no deduction without an invoice/bon. Only records with a matched cost document count.
    const reclaimableCents = known.filter(r => DEDUCTIBLE_STATUSES.has(r.status)).reduce((sum, r) => sum + (r.vat_cents ?? 0), 0)
    const pendingCents = known.filter(r => !DEDUCTIBLE_STATUSES.has(r.status)).reduce((sum, r) => sum + (r.vat_cents ?? 0), 0)
    const unresolvedCount = inQuarter.filter(r => r.bank_transaction_id && !r.vat_source).length
    const conflictCount = inQuarter.filter(r => r.vat_conflict != null).length
    const payable = btwQuarters?.find(q => q.quarter === quarter)?.netIndicationCents ?? null
    return {
      quarter,
      label: quarterLabel(quarter),
      reclaimableCents,
      pendingCents,
      payableCents: payable,
      positionCents: payable == null ? null : payable - reclaimableCents,
      unresolvedCount,
      conflictCount,
    }
  })
  return { counts, open, vat }
}

/** Two quarters back is all the VAT cards read; the status counts want every row but only one column. */
export async function loadExpenseSummary(supabase: SupabaseClient, today: Date = new Date()): Promise<ExpenseSummary> {
  const [previous] = previousQuarters(1, today)
  const since = quarterRange(previous).start.toISOString()
  const [vatRes, statusRes, btw] = await Promise.all([
    supabase
      .from('finance_expenses')
      .select('status, vat_cents, vat_source, vat_conflict, bank_transaction_id, paid_at, invoice_date, created_at')
      .or(`paid_at.gte.${since},and(paid_at.is.null,invoice_date.gte.${since.slice(0, 10)}),and(paid_at.is.null,invoice_date.is.null,created_at.gte.${since})`),
    supabase.from('finance_expenses').select('status'),
    // The sales side is a different subsystem; if it is down, the purchase side still shows.
    computeBtwDashboard(supabase).then(d => d.quarters).catch(err => {
      console.error('[finance/expenses/summary] BTW dashboard unavailable:', err instanceof Error ? err.message : err)
      return null
    }),
  ])
  if (vatRes.error) throw new Error(vatRes.error.message)
  if (statusRes.error) throw new Error(statusRes.error.message)
  const vatRows = (vatRes.data ?? []) as ExpenseSummaryRow[]
  const summary = summarizeExpenses(vatRows, btw, today)
  // Counts over ALL rows (one column), not just the VAT window.
  const counts = Object.fromEntries(EXPENSE_STATUSES.map(s => [s, 0])) as Record<ExpenseStatus, number>
  for (const r of (statusRes.data ?? []) as Array<{ status: string }>) if (r.status in counts) counts[r.status as ExpenseStatus]++
  return { ...summary, counts, open: OPEN_STATUSES.reduce((n, s) => n + counts[s], 0) }
}
