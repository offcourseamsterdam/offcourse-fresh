import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { diffChanges, logFinanceEvent } from '@/lib/finance/cockpit/events'
import { CLASSIFICATION_RULE_KEYS, classificationRuleUpdateSchema, isUuid, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** PUT /api/admin/finance/cockpit/classification-rules/[id] — partial update. */
export async function PUT(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid rule id', 400)
  const parsed = await parseBody(request, classificationRuleUpdateSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_classification_rules').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Classification rule not found', 404)

    const patch: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() }
    if (typeof patch.pattern === 'string') patch.pattern = patch.pattern.trim().toLowerCase()

    const { data: after, error } = await supabase
      .from('finance_classification_rules')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()

    if (error || !after) {
      if (error?.code === '23505') {
        return apiError('Er bestaat al een regel met dit patroon voor dit veld en deze richting', 409)
      }
      return apiError(error?.message ?? 'Could not update classification rule', 500)
    }

    await logFinanceEvent(supabase, {
      event_type: 'classification_rule_updated',
      actor: 'user',
      entity_type: 'classification_rule',
      entity_id: id,
      payload: diffChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, CLASSIFICATION_RULE_KEYS),
    })

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/classification-rules/[id] PUT]', err)
    return apiError(err instanceof Error ? err.message : 'Could not update classification rule', 500)
  }
}

/**
 * DELETE /api/admin/finance/cockpit/classification-rules/[id]
 * Soft delete: is_active becomes false. Never hard-deleted — hit_count / last_hit_at
 * are provenance worth keeping even for a retired rule.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid rule id', 400)

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_classification_rules').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Classification rule not found', 404)
    if (!before.is_active) return apiOk(before)

    const { data: after, error } = await supabase
      .from('finance_classification_rules')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not deactivate classification rule', 500)

    await logFinanceEvent(supabase, {
      event_type: 'classification_rule_deactivated',
      actor: 'user',
      entity_type: 'classification_rule',
      entity_id: id,
      payload: { pattern: before.pattern, match_field: before.match_field, direction: before.direction },
    })

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/classification-rules/[id] DELETE]', err)
    return apiError(err instanceof Error ? err.message : 'Could not deactivate classification rule', 500)
  }
}
