import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { classificationRuleCreateSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/** GET /api/admin/finance/cockpit/classification-rules — every rule (active and inactive), newest first. */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.from('finance_classification_rules').select('*').order('created_at', { ascending: false })
    if (error) return apiError(error.message, 500)
    return apiOk(data ?? [])
  } catch (err) {
    console.error('[finance/cockpit/classification-rules GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load classification rules', 500)
  }
}

/**
 * POST /api/admin/finance/cockpit/classification-rules
 * {match_field, pattern, direction, category, subcategory?, boat_id?, goal_id?, priority?, note?}
 * The pattern is stored trimmed+lowercased so lookups match how rules.ts reads it.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, classificationRuleCreateSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('finance_classification_rules')
      .insert({
        match_field: body.match_field,
        pattern: body.pattern.trim().toLowerCase(),
        direction: body.direction,
        category: body.category,
        subcategory: body.subcategory ?? null,
        boat_id: body.boat_id ?? null,
        goal_id: body.goal_id ?? null,
        priority: body.priority,
        note: body.note ?? null,
      })
      .select('*')
      .single()

    if (error || !data) {
      if (error?.code === '23505') {
        return apiError('Er bestaat al een regel met dit patroon voor dit veld en deze richting', 409)
      }
      return apiError(error?.message ?? 'Could not create classification rule', 500)
    }

    await logFinanceEvent(supabase, {
      event_type: 'classification_rule_created',
      actor: 'user',
      entity_type: 'classification_rule',
      entity_id: data.id,
      payload: { match_field: data.match_field, pattern: data.pattern, direction: data.direction, category: data.category, subcategory: data.subcategory },
    })

    return apiOk(data, 201)
  } catch (err) {
    console.error('[finance/cockpit/classification-rules POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not create classification rule', 500)
  }
}
