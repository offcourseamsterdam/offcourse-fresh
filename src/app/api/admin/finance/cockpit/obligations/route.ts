import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { obligationCreateSchema, obligationStatusFilterSchema, parseBody, parseQuery } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/** GET /api/admin/finance/cockpit/obligations?status=open|paid|cancelled|all (default open), ordered by due date. */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const status = parseQuery(request, 'status', obligationStatusFilterSchema, 'open')
  if (!status.ok) return status.response

  try {
    const supabase = createAdminClient()
    let query = supabase.from('finance_obligations').select('*').order('due_date', { ascending: true })
    if (status.data !== 'all') query = query.eq('status', status.data)
    const { data, error } = await query
    if (error) return apiError(error.message, 500)
    return apiOk(data ?? [])
  } catch (err) {
    console.error('[finance/cockpit/obligations GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load obligations', 500)
  }
}

/**
 * POST /api/admin/finance/cockpit/obligations — create a manual obligation.
 * kind 'loan' is rejected: loan payments come from the materialised loan schedule,
 * so a manual loan row would be counted twice.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, obligationCreateSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('finance_obligations')
      .insert({
        title: parsed.data.title,
        kind: parsed.data.kind,
        amount_cents: parsed.data.amount_cents,
        due_date: parsed.data.due_date,
        recurrence_months: parsed.data.recurrence_months ?? null,
        recurrence_until: parsed.data.recurrence_until ?? null,
        boat_id: parsed.data.boat_id ?? null,
        notes: parsed.data.notes ?? null,
        status: 'open',
      })
      .select('*')
      .single()
    if (error || !data) return apiError(error?.message ?? 'Could not create obligation', 500)

    await logFinanceEvent(supabase, {
      event_type: 'obligation_created',
      actor: 'user',
      entity_type: 'obligation',
      entity_id: data.id,
      payload: { title: data.title, kind: data.kind, amount_cents: data.amount_cents, due_date: data.due_date, recurrence_months: data.recurrence_months },
    })

    return apiOk(data, 201)
  } catch (err) {
    console.error('[finance/cockpit/obligations POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not create obligation', 500)
  }
}
