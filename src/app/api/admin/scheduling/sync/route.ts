import { NextRequest, after } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncBodySchema } from '@/lib/scheduling/shift-schema'
import { syncShiftsForRange } from '@/lib/scheduling/sync-shifts'
import { scheduleAcrossRange } from '@/lib/scheduling/proactive-scheduling'

/**
 * POST /api/admin/scheduling/sync { from, to }
 *
 * Pulls bookings + shifts for the date range, runs the pure generator,
 * applies the result. Also re-fetches the source bookings of shifts already
 * in the range (by id / departure pk) so a booking that moved OUT of the
 * range or got cancelled still updates its shift.
 *
 * Off the response path: once the sync itself lands, try to auto-assign a
 * captain for every date in the range — a manual sync can just as easily
 * surface a newly-open shift as a webhook can, so it gets the same proactive
 * treatment (see src/lib/scheduling/proactive-scheduling.ts). Kept off the
 * response so the admin's Sync button doesn't wait on a run of Claude calls.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const parsed = syncBodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid body', 400)
    const { from, to } = parsed.data

    const result = await syncShiftsForRange(createAdminClient(), from, to)
    if ('error' in result) return apiError(result.error)

    after(() => scheduleAcrossRange(from, to).catch(err => console.error('[scheduling/sync] auto-assign failed:', err)))

    return apiOk(result)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
