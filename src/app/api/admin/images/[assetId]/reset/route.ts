import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const { assetId } = await params
    const supabase = createAdminClient()

    const { error } = await supabase
      .from('image_assets')
      .update({ status: 'pending', failure_reason: null })
      .eq('id', assetId)

    if (error) return apiError(error.message, 500)

    return apiOk({ assetId, status: 'pending' })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
