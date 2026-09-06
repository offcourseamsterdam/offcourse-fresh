import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { diffChanges, logFinanceEvent } from '@/lib/finance/cockpit/events'
import { GOAL_KEYS, goalUpdateSchema, isUuid, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * PUT /api/admin/finance/cockpit/goals/[id] — partial update.
 * A change to funded_cents is a reserve movement and gets its own
 * 'goal_funding_changed' event (delta = new − old); any other change is 'goal_updated'.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid goal id', 400)
  const parsed = await parseBody(request, goalUpdateSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_goals').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Goal not found', 404)
    if (before.status === 'completed') return apiError('A completed goal cannot be edited', 400)

    const updatePayload: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() }

    // If goal_type or description is provided, encode into description JSON
    if (parsed.data.goal_type !== undefined || parsed.data.description !== undefined) {
      let currentType = 'target'
      let currentNotes = before.description
      if (before.description && before.description.startsWith('{"type":')) {
        try {
          const prev = JSON.parse(before.description)
          currentType = prev.type || 'target'
          currentNotes = prev.notes || null
        } catch {
          // ignore
        }
      }
      const newType = parsed.data.goal_type ?? currentType
      const newNotes = parsed.data.description !== undefined ? parsed.data.description : currentNotes
      updatePayload.description = JSON.stringify({ type: newType, notes: newNotes })
      delete updatePayload.goal_type
    }

    const { data: after, error } = await supabase
      .from('finance_goals')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not update goal', 500)

    if (after.funded_cents !== before.funded_cents) {
      await logFinanceEvent(supabase, {
        event_type: 'goal_funding_changed',
        actor: 'user',
        entity_type: 'goal',
        entity_id: id,
        delta_cents: after.funded_cents - before.funded_cents,
        payload: { before: before.funded_cents, after: after.funded_cents, reason: 'manual' },
      })
    }
    const otherKeys = GOAL_KEYS.filter(k => k !== 'funded_cents')
    const diff = diffChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, otherKeys)
    if (diff.changed.length > 0) {
      await logFinanceEvent(supabase, {
        event_type: 'goal_updated',
        actor: 'user',
        entity_type: 'goal',
        entity_id: id,
        payload: diff,
      })
    }

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/goals/[id] PUT]', err)
    return apiError(err instanceof Error ? err.message : 'Could not update goal', 500)
  }
}

/** DELETE /api/admin/finance/cockpit/goals/[id] — hard delete; its reserve is released (delta = −funded). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid goal id', 400)

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_goals').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Goal not found', 404)

    const { error } = await supabase.from('finance_goals').delete().eq('id', id)
    if (error) return apiError(error.message, 500)

    await logFinanceEvent(supabase, {
      event_type: 'goal_deleted',
      actor: 'user',
      entity_type: 'goal',
      entity_id: id,
      delta_cents: -before.funded_cents,
      payload: { name: before.name, target_cents: before.target_cents, funded_cents: before.funded_cents, status: before.status },
    })

    return apiOk({ id, deleted: true })
  } catch (err) {
    console.error('[finance/cockpit/goals/[id] DELETE]', err)
    return apiError(err instanceof Error ? err.message : 'Could not delete goal', 500)
  }
}
