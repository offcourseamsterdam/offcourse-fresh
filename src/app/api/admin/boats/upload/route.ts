import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { validateUpload, createPendingAsset } from '@/lib/images/upload-helper'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/boats/upload
 *
 * Uploads a boat photo to Supabase storage (cruise-images bucket, boats/ prefix)
 * and updates the boat record with the new URL.
 *
 * Body: FormData { file, boatId, field: 'photo_url' | 'photo_covered_url' | 'photo_interior_url' }
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const boatId = formData.get('boatId') as string | null
    const field = formData.get('field') as string | null

    if (!file || !boatId || !field) {
      return apiError('file, boatId and field are required', 400)
    }

    const validFields = ['photo_url', 'photo_covered_url', 'photo_interior_url']
    if (!validFields.includes(field)) {
      return apiError('Invalid field name', 400)
    }

    const validation = await validateUpload(file)
    if (!validation.ok) return apiError(validation.error, validation.status)

    const result = await createPendingAsset({
      buffer: validation.buffer,
      bucket: 'cruise-images',
      ext: validation.ext,
      mimeType: validation.mimeType,
      context: 'boat',
      contextId: boatId,
      pathPrefix: `boats/${boatId}`,
    })

    // Update the boat record with the new URL
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('boats')
      .update({ [field]: result.originalUrl })
      .eq('id', boatId)

    if (error) return apiError(error.message)

    return apiOk({ url: result.originalUrl })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
