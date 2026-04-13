import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm']
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm']

const MAX_SIZE = 50 * 1024 * 1024 // 50MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return apiError('No file provided', 400)

    const ext = (file.name.split('.').pop() ?? '').toLowerCase()

    if (!ALLOWED_TYPES.includes(file.type)) {
      return apiError('Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, WebM', 400)
    }
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return apiError('Invalid file extension', 400)
    }
    if (file.size > MAX_SIZE) {
      return apiError('File too large. Maximum size is 50MB', 400)
    }

    const mediaType = ALLOWED_IMAGE_TYPES.includes(file.type) ? 'image' : 'video'
    const path = `${crypto.randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const supabase = createAdminClient()
    const { error: uploadError } = await supabase.storage
      .from('hero-images')
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      return apiError(uploadError.message)
    }

    const { data: { publicUrl } } = supabase.storage.from('hero-images').getPublicUrl(path)

    return apiOk({ url: publicUrl, path, mediaType })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
