import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { validateUpload, createPendingAsset } from '@/lib/images/upload-helper'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const listingId = formData.get('listingId') as string | null

    if (!file || !listingId) {
      return apiError('file and listingId are required', 400)
    }

    const validation = await validateUpload(file)
    if (!validation.ok) return apiError(validation.error, validation.status)

    const result = await createPendingAsset({
      buffer: validation.buffer,
      bucket: 'cruise-images',
      ext: validation.ext,
      mimeType: validation.mimeType,
      context: 'cruise',
      contextId: listingId,
      pathPrefix: listingId,
    })

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
