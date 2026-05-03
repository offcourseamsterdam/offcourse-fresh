import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { processAsset } from '@/lib/images/processor'
import { createAdminClient } from '@/lib/supabase/admin'

// Long-running: serial processing of up to ~20 images. Each takes 15-30s.
export const maxDuration = 600

interface BatchBody {
  assetIds?: string[]
  // OR — process all pending images
  status?: 'pending' | 'failed'
  limit?: number
}

/**
 * Batch processing endpoint. Accepts either:
 *   { assetIds: ["uuid1", "uuid2"] }
 *   { status: "pending", limit: 10 }
 *
 * Processes serially to avoid hammering Gemini and Storage. Returns a per-asset
 * result array. Frontend can poll /list to see status updates.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as BatchBody

    let assetIds: string[]
    if (body.assetIds && body.assetIds.length > 0) {
      assetIds = body.assetIds
    } else if (body.status) {
      const supabase = createAdminClient()
      const { data, error } = await supabase
        .from('image_assets')
        .select('id')
        .eq('status', body.status)
        .order('created_at', { ascending: true })
        .limit(body.limit ?? 20)
      if (error) return apiError(error.message)
      assetIds = (data ?? []).map(r => r.id)
    } else {
      return apiError('Provide either assetIds or status', 400)
    }

    if (assetIds.length === 0) return apiOk({ processed: 0, results: [] })

    const results = []
    for (const id of assetIds) {
      results.push(await processAsset(id))
    }

    const succeeded = results.filter(r => r.ok).length
    return apiOk({
      processed: assetIds.length,
      succeeded,
      failed: assetIds.length - succeeded,
      results,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
