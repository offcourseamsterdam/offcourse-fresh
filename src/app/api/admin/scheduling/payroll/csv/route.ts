import { NextRequest, NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchPayrollRange } from '@/lib/scheduling/payroll-query'
import { buildPayrollCsv } from '@/lib/scheduling/payroll-csv'

/**
 * GET /api/admin/scheduling/payroll/csv?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The payroll period as a CSV file download. Cookie auth carries through a
 * browser navigation, so the Payroll tab links straight to this URL.
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
    const { entries, staff } = await fetchPayrollRange(supabase, from, to)
    const csv = buildPayrollCsv(entries, staff)

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
