import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOverviewKPIs, getTrafficByDay, getChannelMetrics, type BookingCategory } from '@/lib/tracking/queries'

/**
 * GET /api/admin/tracking/overview?from=2024-01-01&to=2024-01-31
 *
 * Returns dashboard-level KPIs, traffic-by-day chart data, and top channels.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    if (!from || !to) {
      return apiError('Missing from/to date parameters', 400)
    }

    const category = (searchParams.get('category') ?? 'all') as BookingCategory
    const supabase = createAdminClient()
    const range = { from, to }

    const [kpis, trafficByDay, channels] = await Promise.all([
      getOverviewKPIs(supabase, range, category),
      getTrafficByDay(supabase, range, category),
      getChannelMetrics(supabase, range, category),
    ])

    return apiOk({ kpis, trafficByDay, channels })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
