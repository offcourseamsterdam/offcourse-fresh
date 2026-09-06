import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { diffChanges, logFinanceEvent } from '@/lib/finance/cockpit/events'
import { OBLIGATION_KEYS, isUuid, obligationUpdateSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** PUT /api/admin/finance/cockpit/obligations/[id] — partial update of a manual obligation. */
export async function PUT(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid obligation id', 400)
  const parsed = await parseBody(request, obligationUpdateSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_obligations').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Obligation not found', 404)

    // Re-pointing a drafted payment to a different payee must not silently pay the OLD one's
    // draft on the NEW supplier's behalf — the stale draft id is cleared, never reused, and never
    // auto-cancelled in Revolut (Beer decides there whether to delete it).
    const supplierChanging = 'supplier_id' in parsed.data && parsed.data.supplier_id !== before.supplier_id
    const patch = { ...parsed.data, ...(supplierChanging && before.revolut_draft_id ? { revolut_draft_id: null } : {}), updated_at: new Date().toISOString() }

    const { data: after, error } = await supabase
      .from('finance_obligations')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not update obligation', 500)

    await logFinanceEvent(supabase, {
      event_type: 'obligation_updated',
      actor: 'user',
      entity_type: 'obligation',
      entity_id: id,
      payload: diffChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, OBLIGATION_KEYS),
    })

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/obligations/[id] PUT]', err)
    return apiError(err instanceof Error ? err.message : 'Could not update obligation', 500)
  }
}

/** DELETE /api/admin/finance/cockpit/obligations/[id] — soft delete: status becomes 'cancelled'. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid obligation id', 400)

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_obligations').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Obligation not found', 404)
    if (before.status === 'cancelled') return apiOk(before)

    const { data: after, error } = await supabase
      .from('finance_obligations')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not cancel obligation', 500)

    await logFinanceEvent(supabase, {
      event_type: 'obligation_cancelled',
      actor: 'user',
      entity_type: 'obligation',
      entity_id: id,
      payload: { title: before.title, amount_cents: before.amount_cents, due_date: before.due_date, previous_status: before.status },
    })

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/obligations/[id] DELETE]', err)
    return apiError(err instanceof Error ? err.message : 'Could not cancel obligation', 500)
  }
}
