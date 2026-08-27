import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { validateUpload, createPendingAsset } from '@/lib/images/upload-helper'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST /api/admin/cruise-listings/[id]/chef-photo
 *
 * Uploads a food-host/chef photo for a "private food cruise" listing (e.g. Ash on
 * the Curaçao Jamaican Buffet Cruise) and writes it onto the listing's own
 * chef_photo_url / chef_photo_asset_id columns — mirrors src/app/api/admin/boats/upload,
 * just scoped to a listing instead of a boat since a chef isn't a reusable boats-table row.
 *
 * Body: FormData { file }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return apiError('file is required', 400)

    const validation = await validateUpload(file)
    if (!validation.ok) return apiError(validation.error, validation.status)

    const result = await createPendingAsset({
      buffer: validation.buffer,
      bucket: 'cruise-images',
      ext: validation.ext,
      mimeType: validation.mimeType,
      context: 'people',
      contextId: id,
      pathPrefix: `cruise-listings/${id}/chef`,
    })

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('cruise_listings')
      .update({ chef_photo_url: result.originalUrl, chef_photo_asset_id: result.assetId })
      .eq('id', id)

    if (error) return apiError(error.message)

    return apiOk({ url: result.originalUrl })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
