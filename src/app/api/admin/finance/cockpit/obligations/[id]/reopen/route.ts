import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { isUuid } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/** POST /api/admin/finance/cockpit/obligations/[id]/reopen — back to 'open', paid fields cleared. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid obligation id', 400)

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_obligations').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Obligation not found', 404)
    if (before.status === 'open') return apiError('Obligation is already open', 400)

    const { data: after, error } = await supabase
      .from('finance_obligations')
      .update({ status: 'open', paid_at: null, paid_transaction_id: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not reopen obligation', 500)

    await logFinanceEvent(supabase, {
      event_type: 'obligation_reopened',
      actor: 'user',
      entity_type: 'obligation',
      entity_id: id,
      delta_cents: before.status === 'paid' ? -before.amount_cents : null,
      payload: { title: before.title, due_date: before.due_date, previous_status: before.status },
    })

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/obligations/[id]/reopen]', err)
    return apiError(err instanceof Error ? err.message : 'Could not reopen obligation', 500)
  }
}
