import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { materializeLoanSchedule } from '@/lib/finance/cockpit/loans/materialize'
import { summarizeLoanPayments, type LoanPaymentLike } from '@/lib/finance/cockpit/loans/summary'
import { loanCreateSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/** GET /api/admin/finance/cockpit/loans — every loan (all statuses) with a summary of its schedule. */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const [loansRes, paymentsRes] = await Promise.all([
      supabase.from('finance_loans').select('*').order('start_date', { ascending: true }),
      supabase.from('finance_loan_payments').select('loan_id, due_date, interest_cents, principal_cents, total_cents, is_paid'),
    ])
    if (loansRes.error) return apiError(loansRes.error.message, 500)
    if (paymentsRes.error) return apiError(paymentsRes.error.message, 500)

    const byLoan = new Map<string, LoanPaymentLike[]>()
    for (const p of paymentsRes.data ?? []) {
      const list = byLoan.get(p.loan_id) ?? []
      list.push(p)
      byLoan.set(p.loan_id, list)
    }

    return apiOk((loansRes.data ?? []).map(loan => ({ ...loan, summary: summarizeLoanPayments(byLoan.get(loan.id) ?? []) })))
  } catch (err) {
    console.error('[finance/cockpit/loans GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load loans', 500)
  }
}

/**
 * POST /api/admin/finance/cockpit/loans — create a loan and materialise its
 * repayment schedule into finance_loan_payments in one go.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, loanCreateSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { tranches, notes, ...terms } = parsed.data
    const { data: loan, error } = await supabase
      .from('finance_loans')
      .insert({ ...terms, tranches: tranches ?? [], notes: notes ?? null, status: 'active' })
      .select('*')
      .single()
    if (error || !loan) return apiError(error?.message ?? 'Could not create loan', 500)

    let materialized
    try {
      materialized = await materializeLoanSchedule(supabase, loan.id)
    } catch (schedErr) {
      // The schedule engine rejected the terms (e.g. tranche sum): drop the
      // half-created loan so no loan exists without a schedule.
      await supabase.from('finance_loans').delete().eq('id', loan.id)
      return apiError(schedErr instanceof Error ? schedErr.message : 'Could not build loan schedule', 400)
    }

    await logFinanceEvent(supabase, {
      event_type: 'loan_created',
      actor: 'user',
      entity_type: 'loan',
      entity_id: loan.id,
      payload: { name: loan.name, lender_name: loan.lender_name, principal_cents: loan.principal_cents, start_date: loan.start_date, repayment_type: loan.repayment_type, schedule: materialized },
    })

    return apiOk({ loan, schedule: materialized }, 201)
  } catch (err) {
    console.error('[finance/cockpit/loans POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not create loan', 500)
  }
}
