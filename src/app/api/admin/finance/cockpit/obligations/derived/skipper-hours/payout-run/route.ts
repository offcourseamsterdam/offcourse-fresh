import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayISO } from '@/lib/finance/cockpit/dates'
import { accrueSkipperHours, buildPayoutRun } from '@/lib/finance/cockpit/derived/skipper-hours'
import { parseQuery, yearMonthQuerySchema } from '@/lib/finance/cockpit/schemas'
import { loadSkipperAccrualInputs } from '../shared'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/finance/cockpit/obligations/derived/skipper-hours/payout-run?month=YYYY-MM
 *
 * One Revolut payment draft's worth of lines: every skipper owed for that
 * month, priced and ready. Wiring this to POST /payment-drafts is explicitly
 * Phase 4 — this route only previews the run.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const month = parseQuery(request, 'month', yearMonthQuerySchema, '')
  if (!month.ok) return month.response
  if (!month.data) return apiError('month is required (YYYY-MM)', 400)

  try {
    const supabase = createAdminClient()
    const since = `${month.data}-01`
    const { shifts, timeEntries, bonuses, staff } = await loadSkipperAccrualInputs(supabase, since)
    const result = accrueSkipperHours(shifts, timeEntries, bonuses, staff, { today: todayISO() })
    const run = buildPayoutRun(result, month.data)
    return apiOk(run)
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/skipper-hours/payout-run GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not build payout run', 500)
  }
}
