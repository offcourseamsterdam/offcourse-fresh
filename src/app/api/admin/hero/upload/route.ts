import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateUpload, createPendingAsset } from '@/lib/images/upload-helper'

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm']
const VIDEO_EXTENSIONS = ['mp4', 'webm']
const MAX_VIDEO_SIZE = 50 * 1024 * 1024 // 50MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return apiError('No file provided', 400)

    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type)
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)

    if (!isImage && !isVideo) {
      return apiError('Invalid file type. Allowed: JPEG, PNG, WebP, GIF, AVIF, MP4, WebM', 400)
    }

    // Videos: legacy upload-as-is, no Sharp / no asset record
    if (isVideo) {
      const ext = (file.name.split('.').pop() ?? '').toLowerCase()
      if (!VIDEO_EXTENSIONS.includes(ext)) return apiError('Invalid video extension', 400)
      if (file.size > MAX_VIDEO_SIZE) return apiError('Video too large. Maximum 50MB', 400)

      const buffer = Buffer.from(await file.arrayBuffer())
      const path = `${crypto.randomUUID()}.${ext}`
      const supabase = createAdminClient()
      const { error: uploadError } = await supabase.storage
        .from('hero-images')
        .upload(path, buffer, {
          contentType: file.type,
          upsert: false,
          cacheControl: 'public, max-age=31536000, immutable',
        })
      if (uploadError) return apiError(uploadError.message)
      const { data: { publicUrl } } = supabase.storage.from('hero-images').getPublicUrl(path)
      return apiOk({ url: publicUrl, path, mediaType: 'video' })
    }

    // Images: full pipeline-aware path
    const validation = await validateUpload(file)
    if (!validation.ok) return apiError(validation.error, validation.status)

    const result = await createPendingAsset({
      buffer: validation.buffer,
      bucket: 'hero-images',
      ext: validation.ext,
      mimeType: validation.mimeType,
      context: 'hero',
    })

    return apiOk({
      assetId: result.assetId,
      status: result.status,
      url: result.originalUrl,
      mediaType: 'image',
      deduplicated: result.deduplicated,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
