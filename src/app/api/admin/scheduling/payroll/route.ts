import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { aggregatePayroll, type PayrollTimeEntry } from '@/lib/scheduling/payroll'

/**
 * GET /api/admin/scheduling/payroll?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns per-staff payroll lines plus the raw entries (for the detail/flag
 * view) over the date range, keyed on clock_in_at. Pay uses each entry's
 * snapshot rate — see lib/scheduling/payroll.ts.
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

    // Range is inclusive of the whole `to` day (Amsterdam ≈ UTC+1/2; the day
    // boundary blur is acceptable for a payroll period that spans weeks).
    const fromIso = `${from}T00:00:00.000Z`
    const toIso = `${to}T23:59:59.999Z`

    const [entriesRes, staffRes] = await Promise.all([
      supabase
        .from('time_entries')
        .select('id, staff_id, clock_in_at, clock_out_at, hourly_rate_cents, flag, source, note, shift_id')
        .gte('clock_in_at', fromIso)
        .lte('clock_in_at', toIso)
        .order('clock_in_at', { ascending: true }),
      supabase
        .from('staff')
        .select('id, name, role')
        .order('name', { ascending: true }),
    ])
    if (entriesRes.error) return apiError(entriesRes.error.message, 500)
    if (staffRes.error) return apiError(staffRes.error.message, 500)

    const entries = entriesRes.data ?? []
    const staff = staffRes.data ?? []
    const lines = aggregatePayroll(entries as PayrollTimeEntry[], staff)

    return apiOk({ lines, entries, staff, from, to })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load payroll', 500)
  }
}
