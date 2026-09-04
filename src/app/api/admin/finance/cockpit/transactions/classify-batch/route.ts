import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { classifyAndApply, loadRuleContext } from '@/lib/finance/cockpit/classify/apply'
import { classifyBatchSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

/**
 * POST /api/admin/finance/cockpit/transactions/classify-batch {limit?}
 *
 * Runs the deterministic-then-AI pipeline over the oldest unclassified rows.
 * `limit` defaults to 50 and caps at 500 — deliberately small even when the
 * unclassified backlog is much bigger, so one call (cron or a manual "classify
 * more" click) never turns into an unbounded scan of the whole table.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, classifyBatchSchema)
  if (!parsed.ok) return parsed.response
  const limit = Math.min(MAX_LIMIT, parsed.data.limit ?? DEFAULT_LIMIT)

  try {
    const supabase = createAdminClient()
    const { data: rows, error } = await supabase
      .from('bank_transactions')
      .select('*')
      .is('category', null)
      .order('created_at', { ascending: true })
      .limit(limit)
    if (error) return apiError(error.message, 500)

    const transactions = rows ?? []
    if (transactions.length === 0) {
      return apiOk({ processed: 0, classified: 0, needsReview: 0, unresolved: 0 })
    }

    const ctx = await loadRuleContext(supabase)

    let classified = 0
    let needsReview = 0
    let unresolved = 0
    for (const row of transactions) {
      const outcome = await classifyAndApply(supabase, row, ctx, { actor: 'cron' })
      if (!outcome.classification) unresolved++
      else if (outcome.needsReview) needsReview++
      else classified++
    }

    return apiOk({ processed: transactions.length, classified, needsReview, unresolved })
  } catch (err) {
    console.error('[finance/cockpit/transactions/classify-batch]', err)
    return apiError(err instanceof Error ? err.message : 'Could not classify transactions', 500)
  }
}
