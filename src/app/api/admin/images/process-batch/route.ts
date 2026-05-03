import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { processAsset } from '@/lib/images/processor'
import { createAdminClient } from '@/lib/supabase/admin'

// Vercel Hobby caps at 300s. Each image takes ~10-20s, so batch limit
// is enforced to ~10 per call below.
export const maxDuration = 300

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
        // Cap at 10 per call: 10 × 20s = 200s, safely under Hobby's 300s limit.
        // Frontend can call again with more if there are still pending images.
        .limit(Math.min(body.limit ?? 10, 10))
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
