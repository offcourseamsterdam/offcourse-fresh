import { NextRequest, NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildPayrollCsv, type CsvTimeEntry } from '@/lib/scheduling/payroll-csv'
import type { PayrollStaff } from '@/lib/scheduling/payroll'

/**
 * GET /api/admin/scheduling/payroll/csv?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Streams a per-entry payroll CSV for the range as a file download. Cookie
 * auth carries through a browser navigation, so the Payroll tab can link
 * straight to this URL.
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
    const [entriesRes, staffRes] = await Promise.all([
      supabase
        .from('time_entries')
        .select('id, staff_id, clock_in_at, clock_out_at, hourly_rate_cents, flag, source, note')
        .gte('clock_in_at', `${from}T00:00:00.000Z`)
        .lte('clock_in_at', `${to}T23:59:59.999Z`)
        .order('clock_in_at', { ascending: true }),
      supabase.from('staff').select('id, name, role'),
    ])
    if (entriesRes.error) return apiError(entriesRes.error.message, 500)
    if (staffRes.error) return apiError(staffRes.error.message, 500)

    const csv = buildPayrollCsv(
      (entriesRes.data ?? []) as CsvTimeEntry[],
      (staffRes.data ?? []) as PayrollStaff[],
    )

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="payroll_${from}_${to}.csv"`,
      },
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to export payroll', 500)
  }
}
