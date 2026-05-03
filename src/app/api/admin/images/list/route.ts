import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const context = url.searchParams.get('context')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 500)

    const supabase = createAdminClient()
    let query = supabase
      .from('image_assets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('status', status)
    if (context) query = query.eq('context', context)

    const { data, error } = await query
    if (error) return apiError(error.message)

    // Aggregated counts for the admin dashboard
    const { data: counts } = await supabase
      .from('image_assets')
      .select('status', { count: 'exact', head: false })

    const statusCounts = (counts ?? []).reduce<Record<string, number>>((acc, row) => {
      const s = row.status as string
      acc[s] = (acc[s] ?? 0) + 1
      return acc
    }, {})

    return apiOk({
      assets: data ?? [],
      counts: {
        pending: statusCounts.pending ?? 0,
        processing: statusCounts.processing ?? 0,
        complete: statusCounts.complete ?? 0,
        failed: statusCounts.failed ?? 0,
        total: (counts ?? []).length,
      },
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
