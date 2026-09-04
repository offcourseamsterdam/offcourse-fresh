import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { diffChanges, logFinanceEvent } from '@/lib/finance/cockpit/events'
import { INVESTMENT_KEYS, investmentUpdateSchema, isUuid, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** GET /api/admin/finance/cockpit/investments/[id] */
export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid investment id', 400)

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.from('finance_investments').select('*').eq('id', id).maybeSingle()
    if (error) return apiError(error.message, 500)
    if (!data) return apiError('Investment not found', 404)
    return apiOk(data)
  } catch (err) {
    console.error('[finance/cockpit/investments/[id] GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load investment', 500)
  }
}

/**
 * PUT /api/admin/finance/cockpit/investments/[id] — partial update.
 * A status change gets its own event so the shortlist's history reads as a
 * decision trail ("idea → approved → executed"), not just field edits.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid investment id', 400)
  const parsed = await parseBody(request, investmentUpdateSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_investments').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Investment not found', 404)

    const { data: after, error } = await supabase
      .from('finance_investments')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not update investment', 500)

    if (after.status !== before.status) {
      await logFinanceEvent(supabase, {
        event_type: 'investment_status_changed',
        actor: 'user',
        entity_type: 'investment',
        entity_id: id,
        payload: { title: after.title, before: before.status, after: after.status, amount_cents: after.amount_cents },
      })
    }
    const diff = diffChanges(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      INVESTMENT_KEYS.filter(k => k !== 'status'),
    )
    if (diff.changed.length > 0) {
      await logFinanceEvent(supabase, {
        event_type: 'investment_updated',
        actor: 'user',
        entity_type: 'investment',
        entity_id: id,
        payload: diff,
      })
    }

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/investments/[id] PUT]', err)
    return apiError(err instanceof Error ? err.message : 'Could not update investment', 500)
  }
}

/** DELETE — hard delete. No reserve to release: an investment never claimed money. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid investment id', 400)

  try {
    const supabase = createAdminClient()
    const { data: before, error: fetchErr } = await supabase.from('finance_investments').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!before) return apiError('Investment not found', 404)

    const { error } = await supabase.from('finance_investments').delete().eq('id', id)
    if (error) return apiError(error.message, 500)

    await logFinanceEvent(supabase, {
      event_type: 'investment_deleted',
      actor: 'user',
      entity_type: 'investment',
      entity_id: id,
      payload: { title: before.title, amount_cents: before.amount_cents, status: before.status },
    })

    return apiOk({ id, deleted: true })
  } catch (err) {
    console.error('[finance/cockpit/investments/[id] DELETE]', err)
    return apiError(err instanceof Error ? err.message : 'Could not delete investment', 500)
  }
}
