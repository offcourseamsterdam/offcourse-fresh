import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncAllDerivedObligations } from '@/lib/finance/cockpit/derived/sync-all'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/finance/cockpit/obligations/sync
 *
 * On-demand trigger to re-compute and upsert all derived obligations:
 * - City tax
 * - BTW (Dutch VAT)
 * - Standing charges (recurring)
 * - Partner commissions
 */
export async function POST(_request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const result = await syncAllDerivedObligations(supabase, 'user')
    return apiOk(result)
  } catch (err) {
    console.error('[finance/cockpit/obligations/sync POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not sync obligations', 500)
  }
}
