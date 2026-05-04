import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Reset failed (or stuck-processing) image_assets back to 'pending'.
 * Optionally pass { ids: ["uuid1","uuid2"] } to reset specific assets only.
 * Without ids, resets all 'failed' AND 'processing' (stuck/timed-out) assets.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { ids?: string[] }
    const supabase = createAdminClient()

    let resetCount = 0

    if (body.ids && body.ids.length > 0) {
      const { error, data } = await supabase
        .from('image_assets')
        .update({ status: 'pending', failure_reason: null, processing_step: null })
        .in('id', body.ids)
        .select('id')
      if (error) return apiError(error.message, 500)
      resetCount = data?.length ?? 0
    } else {
      // Reset both failed and stuck-processing in one go
      const [failedResult, stuckResult] = await Promise.all([
        supabase
          .from('image_assets')
          .update({ status: 'pending', failure_reason: null, processing_step: null })
          .eq('status', 'failed')
          .select('id'),
        supabase
          .from('image_assets')
          .update({ status: 'pending', failure_reason: null, processing_step: null })
          .eq('status', 'processing')
          .select('id'),
      ])
      if (failedResult.error) return apiError(failedResult.error.message, 500)
      if (stuckResult.error) return apiError(stuckResult.error.message, 500)
      resetCount = (failedResult.data?.length ?? 0) + (stuckResult.data?.length ?? 0)
    }

    return apiOk({ reset: resetCount })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
