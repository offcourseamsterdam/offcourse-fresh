import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeBtwDashboard } from '@/lib/finance/btw-dashboard-calculator'

/**
 * GET /api/admin/finance/btw-dashboard/summary
 *
 * The unified BTW view across every kasboek source that has a VAT split,
 * bucketed per quarter.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const result = await computeBtwDashboard(supabase)
    return apiOk(result)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
