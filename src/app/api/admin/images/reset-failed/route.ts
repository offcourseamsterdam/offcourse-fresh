import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Reset all failed image_assets back to 'pending' so they can be reprocessed.
 * Optionally pass { ids: ["uuid1","uuid2"] } to reset specific assets only.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { ids?: string[] }
    const supabase = createAdminClient()

    let query = supabase
      .from('image_assets')
      .update({ status: 'pending', failure_reason: null })

    if (body.ids && body.ids.length > 0) {
      query = query.in('id', body.ids)
    } else {
      query = query.eq('status', 'failed')
    }

    const { error, count } = await query.select()

    if (error) return apiError(error.message, 500)

    return apiOk({ reset: count ?? 0 })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
