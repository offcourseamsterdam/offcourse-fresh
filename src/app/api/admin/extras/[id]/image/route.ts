import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateUpload, createPendingAsset } from '@/lib/images/upload-helper'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return apiError('No file provided', 400)

    const validation = await validateUpload(file)
    if (!validation.ok) return apiError(validation.error, validation.status)

    const result = await createPendingAsset({
      buffer: validation.buffer,
      bucket: 'extras-images',
      ext: validation.ext,
      mimeType: validation.mimeType,
      context: 'extras',
      contextId: id,
      pathPrefix: id,
    })

    // Link the extras row to the new asset
    const supabase = createAdminClient()
    const { error: updateError } = await supabase
      .from('extras')
      .update({
        image_asset_id: result.assetId,
        image_url: result.originalUrl, // legacy fallback for unprocessed images
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) return apiError(updateError.message)

    return apiOk({
      assetId: result.assetId,
      status: result.status,
      url: result.originalUrl,
      deduplicated: result.deduplicated,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
