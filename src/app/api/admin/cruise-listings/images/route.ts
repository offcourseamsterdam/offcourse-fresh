import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createServiceClient } from '@/lib/supabase/server'
import { v4 as uuidv4 } from 'uuid'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const listingId = formData.get('listingId') as string | null

  if (!file || !listingId) {
    return apiError('file and listingId are required', 400)
  }

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif']
  const MAX_SIZE = 10 * 1024 * 1024 // 10MB

  const ext = (file.name.split('.').pop() ?? '').toLowerCase()

  if (!ALLOWED_TYPES.includes(file.type)) {
    return apiError('Invalid file type. Allowed: JPEG, PNG, WebP, GIF', 400)
  }
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return apiError('Invalid file extension', 400)
  }
  if (file.size > MAX_SIZE) {
    return apiError('File too large. Maximum size is 10MB', 400)
  }
  const path = `${listingId}/${uuidv4()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const supabase = await createServiceClient()
  const { error: uploadError } = await supabase.storage
    .from('cruise-images')
    .upload(path, buffer, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    return apiError(uploadError.message)
  }

  const { data: { publicUrl } } = supabase.storage
    .from('cruise-images')
    .getPublicUrl(path)

  return apiOk({ url: publicUrl, path })
}
