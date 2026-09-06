import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayISO } from '@/lib/finance/cockpit/dates'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { goalProgress } from '@/lib/finance/cockpit/goals'
import { goalCreateSchema, goalStatusFilterSchema, parseBody, parseQuery } from '@/lib/finance/cockpit/schemas'
import { toGoalRow } from '@/lib/finance/cockpit/rows'

export const dynamic = 'force-dynamic'

/** GET /api/admin/finance/cockpit/goals?status=active|completed|paused|all (default active), each with progress. */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const status = parseQuery(request, 'status', goalStatusFilterSchema, 'active')
  if (!status.ok) return status.response

  try {
    const supabase = createAdminClient()
    let query = supabase.from('finance_goals').select('*').order('priority', { ascending: true }).order('created_at', { ascending: true })
    if (status.data !== 'all') query = query.eq('status', status.data)
    const { data, error } = await query
    if (error) return apiError(error.message, 500)

    const today = todayISO()
    return apiOk((data ?? []).map(row => ({ ...row, progress: goalProgress(toGoalRow(row), today) })))
  } catch (err) {
    console.error('[finance/cockpit/goals GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load goals', 500)
  }
}

/** POST /api/admin/finance/cockpit/goals — create a goal (funded_cents is a stored planning reserve). */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, goalCreateSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const goalType = parsed.data.goal_type ?? 'target'
    const descPayload = JSON.stringify({ type: goalType, notes: parsed.data.description ?? null })

    const { data, error } = await supabase
      .from('finance_goals')
      .insert({
        name: parsed.data.name,
        description: descPayload,
        target_cents: parsed.data.target_cents,
        funded_cents: parsed.data.funded_cents,
        deadline: parsed.data.deadline ?? null,
        priority: parsed.data.priority,
        monthly_funding_cents: parsed.data.monthly_funding_cents,
        boat_id: parsed.data.boat_id ?? null,
        flexibility: parsed.data.flexibility,
        status: 'active',
      })
      .select('*')
      .single()
    if (error || !data) return apiError(error?.message ?? 'Could not create goal', 500)

    await logFinanceEvent(supabase, {
      event_type: 'goal_created',
      actor: 'user',
      entity_type: 'goal',
      entity_id: data.id,
      delta_cents: data.funded_cents > 0 ? data.funded_cents : null,
      payload: { name: data.name, target_cents: data.target_cents, funded_cents: data.funded_cents, deadline: data.deadline, priority: data.priority, monthly_funding_cents: data.monthly_funding_cents },
    })

    return apiOk({ ...data, progress: goalProgress(toGoalRow(data), todayISO()) }, 201)
  } catch (err) {
    console.error('[finance/cockpit/goals POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not create goal', 500)
  }
}
