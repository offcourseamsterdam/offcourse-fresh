import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { diffChanges, logFinanceEvent } from '@/lib/finance/cockpit/events'
import { materializeLoanSchedule } from '@/lib/finance/cockpit/loans/materialize'
import { summarizeLoanPayments } from '@/lib/finance/cockpit/loans/summary'
import { LOAN_KEYS, isUuid, loanUpdateSchema, parseBody } from '@/lib/finance/cockpit/schemas'
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }
type LoanUpdateRow = Database['public']['Tables']['finance_loans']['Update']

/** GET /api/admin/finance/cockpit/loans/[id] — the loan, its full schedule and a summary. */
export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid loan id', 400)

  try {
    const supabase = createAdminClient()
    const { data: loan, error } = await supabase.from('finance_loans').select('*').eq('id', id).maybeSingle()
    if (error) return apiError(error.message, 500)
    if (!loan) return apiError('Loan not found', 404)

    const { data: payments, error: payErr } = await supabase
      .from('finance_loan_payments')
      .select('*')
      .eq('loan_id', id)
      .order('due_date', { ascending: true })
    if (payErr) return apiError(payErr.message, 500)

    return apiOk({ loan, payments: payments ?? [], summary: summarizeLoanPayments(payments ?? []) })
  } catch (err) {
    console.error('[finance/cockpit/loans/[id] GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load loan', 500)
  }
}

/** PUT /api/admin/finance/cockpit/loans/[id] — change terms and re-materialise the schedule (paid periods untouched). */
export async function PUT(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid loan id', 400)
  const parsed = await parseBody(request, loanUpdateSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_loans').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Loan not found', 404)

    // Tranche sum vs principal must hold on the MERGED terms, not just the patch.
    const mergedPrincipal = parsed.data.principal_cents ?? before.principal_cents
    const mergedTranches = parsed.data.tranches ?? (Array.isArray(before.tranches) ? (before.tranches as Array<{ amount_cents?: number }>) : [])
    if (mergedTranches.length > 0) {
      const sum = mergedTranches.reduce((s, t) => s + (typeof t.amount_cents === 'number' ? t.amount_cents : 0), 0)
      if (sum !== mergedPrincipal) return apiError('Tranches must add up to principal_cents', 400)
    }

    const update: LoanUpdateRow = { ...parsed.data, updated_at: new Date().toISOString() }
    const { data: after, error } = await supabase.from('finance_loans').update(update).eq('id', id).select('*').single()
    if (error || !after) return apiError(error?.message ?? 'Could not update loan', 500)

    let materialized
    try {
      materialized = await materializeLoanSchedule(supabase, id)
    } catch (schedErr) {
      return apiError(schedErr instanceof Error ? schedErr.message : 'Could not rebuild loan schedule', 400)
    }

    await logFinanceEvent(supabase, {
      event_type: 'loan_updated',
      actor: 'user',
      entity_type: 'loan',
      entity_id: id,
      payload: { ...diffChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, LOAN_KEYS), schedule: materialized },
    })

    return apiOk({ loan: after, schedule: materialized })
  } catch (err) {
    console.error('[finance/cockpit/loans/[id] PUT]', err)
    return apiError(err instanceof Error ? err.message : 'Could not update loan', 500)
  }
}

/** DELETE /api/admin/finance/cockpit/loans/[id] — close the loan; unpaid schedule rows are removed, paid rows stay as history. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid loan id', 400)

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_loans').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Loan not found', 404)

    const { data: after, error } = await supabase
      .from('finance_loans')
      .update({ status: 'closed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not close loan', 500)

    const { error: delErr } = await supabase.from('finance_loan_payments').delete().eq('loan_id', id).eq('is_paid', false)
    if (delErr) return apiError(delErr.message, 500)

    await logFinanceEvent(supabase, {
      event_type: 'loan_closed',
      actor: 'user',
      entity_type: 'loan',
      entity_id: id,
      payload: { name: before.name, previous_status: before.status },
    })

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/loans/[id] DELETE]', err)
    return apiError(err instanceof Error ? err.message : 'Could not close loan', 500)
  }
}
