import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { processAsset } from '@/lib/images/processor'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 60

/**
 * Re-run the pipeline on an asset that's already complete.
 * Useful after pipeline updates (new keywords, better Gemini prompt, etc.).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const { assetId } = await params
    const supabase = createAdminClient()
    // Reset status so processAsset will run
    await supabase.from('image_assets').update({ status: 'pending' }).eq('id', assetId)
    const result = await processAsset(assetId)
    if (!result.ok) return apiError(result.error, 500)
    return apiOk(result)
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
