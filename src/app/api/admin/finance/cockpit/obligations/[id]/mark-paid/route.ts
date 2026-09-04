import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { isUuid, markPaidSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/finance/cockpit/obligations/[id]/mark-paid {paid_at?, paid_transaction_id?}
 * The obligation stops being a deduction; the event's delta is the amount that left the plan.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid obligation id', 400)
  const parsed = await parseBody(request, markPaidSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_obligations').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Obligation not found', 404)
    if (before.status === 'cancelled') return apiError('A cancelled obligation cannot be marked paid', 400)
    if (before.status === 'paid') return apiError('Obligation is already paid', 400)

    const paidAt = parsed.data.paid_at ? new Date(parsed.data.paid_at).toISOString() : new Date().toISOString()
    const { data: after, error } = await supabase
      .from('finance_obligations')
      .update({ status: 'paid', paid_at: paidAt, paid_transaction_id: parsed.data.paid_transaction_id ?? null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not mark obligation paid', 500)

    await logFinanceEvent(supabase, {
      event_type: 'obligation_paid',
      actor: 'user',
      entity_type: 'obligation',
      entity_id: id,
      delta_cents: before.amount_cents,
      payload: { title: before.title, due_date: before.due_date, paid_at: paidAt, paid_transaction_id: parsed.data.paid_transaction_id ?? null },
    })

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/obligations/[id]/mark-paid]', err)
    return apiError(err instanceof Error ? err.message : 'Could not mark obligation paid', 500)
  }
}
