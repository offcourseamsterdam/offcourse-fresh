import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { classifyPending } from '@/lib/finance/cockpit/classify/apply'
import { classifyBatchSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

/**
 * POST /api/admin/finance/cockpit/transactions/classify-batch {limit?}
 *
 * Runs the classification pipeline (rules → your own history → AI) over the
 * oldest unclassified rows not already waiting for a human review.
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
    const { processed, classified, needsReview, unresolved } = await classifyPending(supabase, { limit })
    return apiOk({ processed, classified, needsReview, unresolved })
  } catch (err) {
    console.error('[finance/cockpit/transactions/classify-batch]', err)
    return apiError(err instanceof Error ? err.message : 'Could not classify transactions', 500)
  }
}
