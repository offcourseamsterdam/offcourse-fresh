import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { classifyAndApply, loadRuleContext } from '@/lib/finance/cockpit/classify/apply'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { classifyTransactionSchema, isUuid, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/admin/finance/cockpit/transactions/[id]/classify
 * {category, subcategory?, boat_id?, goal_id?, remember_rule?, rule?}
 *
 * A human decision: stored as fact (classifyAndApply's userClassification),
 * never overridden by a later AI pass. Optionally also remembers the pattern
 * as a learned rule so the same correction never has to be made twice.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid transaction id', 400)
  const parsed = await parseBody(request, classifyTransactionSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  try {
    const supabase = createAdminClient()
    const { data: row, error: fetchErr } = await supabase.from('bank_transactions').select('*').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!row) return apiError('Transaction not found', 404)

    const ctx = await loadRuleContext(supabase)
    const outcome = await classifyAndApply(supabase, row, ctx, {
      actor: 'user',
      userClassification: {
        category: body.category as never,
        subcategory: body.subcategory ?? null,
        boatId: body.boat_id ?? null,
        goalId: body.goal_id ?? null,
        confidence: 1,
        reason: 'Handmatig door Beer',
        source: 'user',
      },
    })

    let ruleCreated = false
    if (body.remember_rule && body.rule) {
      const { data: ruleRow, error: ruleErr } = await supabase
        .from('finance_classification_rules')
        .insert({
          match_field: body.rule.match_field,
          pattern: body.rule.pattern.trim().toLowerCase(),
          direction: body.rule.direction,
          category: body.category,
          subcategory: body.subcategory ?? null,
          boat_id: body.boat_id ?? null,
          goal_id: body.goal_id ?? null,
          created_from_transaction_id: id,
          priority: 100,
        })
        .select('id')
        .single()

      if (ruleErr) {
        if (ruleErr.code === '23505') {
          return apiError('Er bestaat al een regel met dit patroon voor dit veld en deze richting', 409)
        }
        return apiError(ruleErr.message, 500)
      }

      ruleCreated = true
      await logFinanceEvent(supabase, {
        event_type: 'classification_rule_created',
        actor: 'user',
        entity_type: 'classification_rule',
        entity_id: ruleRow?.id ?? null,
        payload: {
          match_field: body.rule.match_field,
          pattern: body.rule.pattern.trim().toLowerCase(),
          direction: body.rule.direction,
          category: body.category,
          subcategory: body.subcategory ?? null,
          created_from_transaction_id: id,
        },
      })
    }

    return apiOk({ outcome, ruleCreated })
  } catch (err) {
    console.error('[finance/cockpit/transactions/[id]/classify]', err)
    return apiError(err instanceof Error ? err.message : 'Could not classify transaction', 500)
  }
}
