import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { isUuid, markPaidSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/** POST /api/admin/finance/cockpit/loans/[id]/payments/[paymentId]/mark-paid {paid_at?, paid_transaction_id?} */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id, paymentId } = await params
  if (!isUuid(id) || !isUuid(paymentId)) return apiError('Invalid id', 400)
  const parsed = await parseBody(request, markPaidSchema)
  if (!parsed.ok) return parsed.response

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
    if (before.is_paid) return apiError('Loan payment is already paid', 400)

    const paidAt = parsed.data.paid_at ? new Date(parsed.data.paid_at).toISOString() : new Date().toISOString()
    const { data: after, error } = await supabase
      .from('finance_loan_payments')
      .update({ is_paid: true, paid_at: paidAt, paid_transaction_id: parsed.data.paid_transaction_id ?? null })
      .eq('id', paymentId)
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not mark loan payment paid', 500)

    await logFinanceEvent(supabase, {
      event_type: 'loan_payment_paid',
      actor: 'user',
      entity_type: 'loan_payment',
      entity_id: paymentId,
      delta_cents: before.total_cents,
      payload: { loan_id: id, due_date: before.due_date, interest_cents: before.interest_cents, principal_cents: before.principal_cents, paid_at: paidAt, paid_transaction_id: parsed.data.paid_transaction_id ?? null },
    })

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/loans payments mark-paid]', err)
    return apiError(err instanceof Error ? err.message : 'Could not mark loan payment paid', 500)
  }
}
