import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { goalCompleteSchema, isUuid, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/finance/cockpit/goals/[id]/complete {completed_transaction_id?}
 * The purchase happened: the goal leaves the active set and its reserve is released.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid goal id', 400)
  const parsed = await parseBody(request, goalCompleteSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_goals').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Goal not found', 404)
    if (before.status === 'completed') return apiError('Goal is already completed', 400)

    const now = new Date().toISOString()
    const { data: after, error } = await supabase
      .from('finance_goals')
      .update({ status: 'completed', completed_at: now, completed_transaction_id: parsed.data.completed_transaction_id ?? null, updated_at: now })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not complete goal', 500)

    await logFinanceEvent(supabase, {
      event_type: 'goal_completed',
      actor: 'user',
      entity_type: 'goal',
      entity_id: id,
      delta_cents: -before.funded_cents,
      payload: { name: before.name, target_cents: before.target_cents, funded_cents: before.funded_cents, completed_transaction_id: parsed.data.completed_transaction_id ?? null },
    })

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/goals/[id]/complete]', err)
    return apiError(err instanceof Error ? err.message : 'Could not complete goal', 500)
  }
}
