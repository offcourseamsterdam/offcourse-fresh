import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { processAsset } from '@/lib/images/processor'

// Image processing can take 15-30s (Sharp + Gemini + Claude + Storage uploads).
export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const { assetId } = await params
    const result = await processAsset(assetId)
    if (!result.ok) return apiError(result.error, 500)
    return apiOk(result)
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
