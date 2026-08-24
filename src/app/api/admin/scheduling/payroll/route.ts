import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchPayrollRange } from '@/lib/scheduling/payroll-query'

/**
 * GET /api/admin/scheduling/payroll?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Raw time entries + staff for the range. The Payroll tab aggregates these
 * client-side with lib/scheduling/payroll.ts (it needs the raw entries for
 * the "needs review" panel anyway, so the per-staff lines are derived once,
 * in one place). Pay always uses each entry's snapshot rate.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return apiError('from and to (YYYY-MM-DD) are required', 400)
    }

    const supabase = createAdminClient()
    const { entries, staff, bonuses, extraHoursBonuses } = await fetchPayrollRange(supabase, from, to)
    return apiOk({ entries, staff, bonuses, extraHoursBonuses, from, to })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load payroll', 500)
  }
}
