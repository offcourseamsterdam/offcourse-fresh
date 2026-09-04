import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { isUuid } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/** POST /api/admin/finance/cockpit/loans/[id]/payments/[paymentId]/reopen — undo a mark-paid. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id, paymentId } = await params
  if (!isUuid(id) || !isUuid(paymentId)) return apiError('Invalid id', 400)

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase
      .from('finance_loan_payments')
      .select('*')
      .eq('id', paymentId)
      .eq('loan_id', id)
      .maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Loan payment not found', 404)
    if (!before.is_paid) return apiError('Loan payment is not paid', 400)

    const { data: after, error } = await supabase
      .from('finance_loan_payments')
      .update({ is_paid: false, paid_at: null, paid_transaction_id: null })
      .eq('id', paymentId)
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not reopen loan payment', 500)

    await logFinanceEvent(supabase, {
      event_type: 'loan_payment_reopened',
      actor: 'user',
      entity_type: 'loan_payment',
      entity_id: paymentId,
      delta_cents: -before.total_cents,
      payload: { loan_id: id, due_date: before.due_date },
    })

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/loans payments reopen]', err)
    return apiError(err instanceof Error ? err.message : 'Could not reopen loan payment', 500)
  }
}
