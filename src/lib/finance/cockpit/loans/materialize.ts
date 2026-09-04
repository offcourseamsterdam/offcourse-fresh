/**
 * Writes a loan's derived schedule into finance_loan_payments, one row per
 * period, keyed on (loan_id, due_date).
 *
 * Idempotent: re-running after a loan edit updates unpaid rows in place,
 * inserts new periods, deletes unpaid periods that no longer exist, and never
 * touches a row that is already marked paid (a paid row is history, and its
 * bank link must survive any recalculation).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { buildSchedule, type LoanTerms, type LoanTranche } from './schedule'

type Admin = SupabaseClient<Database>
type LoanRow = Database['public']['Tables']['finance_loans']['Row']

export function loanTermsFromRow(row: LoanRow): LoanTerms {
  const raw = Array.isArray(row.tranches) ? (row.tranches as unknown[]) : []
  const tranches: LoanTranche[] = raw
    .map(t => t as { amount_cents?: number; amountCents?: number; date?: string; note?: string })
    .filter(t => typeof t.date === 'string' && (typeof t.amount_cents === 'number' || typeof t.amountCents === 'number'))
    .map(t => ({ amountCents: (t.amount_cents ?? t.amountCents) as number, date: t.date as string, note: t.note }))
  return {
    principalCents: row.principal_cents,
    interestRatePct: Number(row.interest_rate_pct),
    durationYears: row.duration_years,
    interestFreeYears: row.interest_free_years,
    repaymentType: row.repayment_type as LoanTerms['repaymentType'],
    startDate: row.start_date,
    tranches,
  }
}

export interface MaterializeResult {
  loanId: string
  inserted: number
  updated: number
  deleted: number
  keptPaid: number
}

export async function materializeLoanSchedule(supabase: Admin, loanId: string): Promise<MaterializeResult> {
  const { data: loan, error } = await supabase.from('finance_loans').select('*').eq('id', loanId).single()
  if (error || !loan) throw new Error(error?.message ?? `Loan ${loanId} not found`)

  const schedule = buildSchedule(loanTermsFromRow(loan))

  const { data: existing, error: exErr } = await supabase
    .from('finance_loan_payments')
    .select('id, due_date, is_paid, interest_cents, principal_cents, total_cents')
    .eq('loan_id', loanId)
  if (exErr) throw new Error(exErr.message)

  const byDate = new Map((existing ?? []).map(r => [r.due_date, r]))
  const wanted = new Set(schedule.periods.map(p => p.dueDate))

  let inserted = 0, updated = 0, deleted = 0, keptPaid = 0
  const inserts: Database['public']['Tables']['finance_loan_payments']['Insert'][] = []

  for (const p of schedule.periods) {
    const cur = byDate.get(p.dueDate)
    if (!cur) {
      inserts.push({ loan_id: loanId, due_date: p.dueDate, interest_cents: p.interestCents, principal_cents: p.principalCents, total_cents: p.totalCents })
      inserted++
      continue
    }
    if (cur.is_paid) { keptPaid++; continue }
    if (cur.interest_cents !== p.interestCents || cur.principal_cents !== p.principalCents || cur.total_cents !== p.totalCents) {
      const { error: upErr } = await supabase
        .from('finance_loan_payments')
        .update({ interest_cents: p.interestCents, principal_cents: p.principalCents, total_cents: p.totalCents })
        .eq('id', cur.id)
      if (upErr) throw new Error(upErr.message)
      updated++
    }
  }

  const stale = (existing ?? []).filter(r => !wanted.has(r.due_date) && !r.is_paid).map(r => r.id)
  if (stale.length > 0) {
    const { error: delErr } = await supabase.from('finance_loan_payments').delete().in('id', stale)
    if (delErr) throw new Error(delErr.message)
    deleted = stale.length
  }

  if (inserts.length > 0) {
    const { error: insErr } = await supabase.from('finance_loan_payments').insert(inserts)
    if (insErr) throw new Error(insErr.message)
  }

  return { loanId, inserted, updated, deleted, keptPaid }
}
