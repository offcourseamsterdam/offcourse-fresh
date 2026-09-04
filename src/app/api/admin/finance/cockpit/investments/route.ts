import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { investmentCreateSchema, investmentStatusFilterSchema, parseBody, parseQuery } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/** 'open' = everything still on the table: what the shortlist actually shows by default. */
const OPEN_STATUSES = ['idea', 'planned', 'approved']

/** GET /api/admin/finance/cockpit/investments?status=open (default) | idea|planned|approved|executed|dropped|all */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const status = parseQuery(request, 'status', investmentStatusFilterSchema, 'open')
  if (!status.ok) return status.response

  try {
    const supabase = createAdminClient()
    let query = supabase.from('finance_investments').select('*').order('created_at', { ascending: false })
    if (status.data === 'open') query = query.in('status', OPEN_STATUSES)
    else if (status.data !== 'all') query = query.eq('status', status.data)

    const { data, error } = await query
    if (error) return apiError(error.message, 500)
    return apiOk(data ?? [])
  } catch (err) {
    console.error('[finance/cockpit/investments GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load investments', 500)
  }
}

/**
 * POST /api/admin/finance/cockpit/investments — add a candidate.
 * Creating one never touches the cockpit: an idea is not a commitment, so no
 * obligation, no reservation, nothing deducted from cash (plan §4).
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, investmentCreateSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('finance_investments')
      .insert({
        title: parsed.data.title,
        amount_cents: parsed.data.amount_cents,
        boat_id: parsed.data.boat_id ?? null,
        type: parsed.data.type,
        impact: parsed.data.impact as unknown as Json,
        expected_return_cents: parsed.data.expected_return_cents ?? null,
        goal_id: parsed.data.goal_id ?? null,
        notes: parsed.data.notes ?? null,
        status: 'idea',
      })
      .select('*')
      .single()
    if (error || !data) return apiError(error?.message ?? 'Could not create investment', 500)

    await logFinanceEvent(supabase, {
      event_type: 'investment_created',
      actor: 'user',
      entity_type: 'investment',
      entity_id: data.id,
      // No delta: an idea has not claimed any money.
      payload: { title: data.title, amount_cents: data.amount_cents, type: data.type },
    })

    return apiOk(data, 201)
  } catch (err) {
    console.error('[finance/cockpit/investments POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not create investment', 500)
  }
}
