import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ImageAssetContext } from './types'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']
const MAX_SIZE = 25 * 1024 * 1024 // 25MB — allow large iPhone uploads, Sharp will downsize

export interface UploadValidation {
  ok: true
  buffer: Buffer
  ext: string
  mimeType: string
  size: number
}

export interface UploadValidationError {
  ok: false
  error: string
  status: number
}

/** Validate an uploaded file and return a Buffer ready for processing. */
export async function validateUpload(file: File): Promise<UploadValidation | UploadValidationError> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF, AVIF', status: 400 }
  }
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { ok: false, error: 'Invalid file extension', status: 400 }
  }
  if (file.size > MAX_SIZE) {
    return { ok: false, error: `File too large. Maximum size is ${MAX_SIZE / 1024 / 1024}MB`, status: 400 }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  return { ok: true, buffer, ext, mimeType: file.type, size: file.size }
}

export interface CreatePendingAssetArgs {
  buffer: Buffer
  bucket: string
  ext: string
  mimeType: string
  context: ImageAssetContext
  contextId?: string | null
  /** Subfolder within the bucket (e.g. listingId for cruise images). */
  pathPrefix?: string
}

export interface CreatePendingAssetResult {
  assetId: string
  status: 'pending' | 'complete'    // 'complete' when deduplication finds existing asset
  originalUrl: string
  /** True when this asset already existed (uploaded before) and we just linked to it. */
  deduplicated: boolean
}

/**
 * Upload an original file to Supabase Storage and create / link an image_assets row.
 * Computes SHA-256 hash for deduplication — same image uploaded twice = single asset record.
 */
export async function createPendingAsset(args: CreatePendingAssetArgs): Promise<CreatePendingAssetResult> {
  const sha256 = crypto.createHash('sha256').update(args.buffer).digest('hex')
  const supabase = createAdminClient()

  // Deduplication: did we already process this exact image?
  const { data: existing } = await supabase
    .from('image_assets')
    .select('id, status, original_url')
    .eq('sha256', sha256)
    .maybeSingle()

  if (existing) {
    return {
      assetId: existing.id,
      status: existing.status as 'pending' | 'complete',
      originalUrl: existing.original_url,
      deduplicated: true,
    }
  }

  // Fresh upload — store original under _originals/
  const filename = `${crypto.randomUUID()}.${args.ext}`
  const path = args.pathPrefix
    ? `_originals/${args.pathPrefix}/${filename}`
    : `_originals/${filename}`

  const { error: uploadError } = await supabase.storage
    .from(args.bucket)
    .upload(path, args.buffer, {
      contentType: args.mimeType,
      upsert: false,
      cacheControl: 'public, max-age=31536000, immutable',
    })

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

  const { data: { publicUrl } } = supabase.storage.from(args.bucket).getPublicUrl(path)

  const { data: inserted, error: insertError } = await supabase
    .from('image_assets')
    .insert({
      context: args.context,
      context_id: args.contextId ?? null,
      original_url: publicUrl,
      original_path: path,
      bucket: args.bucket,
      mime_type: args.mimeType,
      file_size_bytes: args.buffer.length,
      sha256,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertError || !inserted) throw new Error(`Failed to create image asset: ${insertError?.message}`)

  return {
    assetId: inserted.id,
    status: 'pending',
    originalUrl: publicUrl,
    deduplicated: false,
  }
}
