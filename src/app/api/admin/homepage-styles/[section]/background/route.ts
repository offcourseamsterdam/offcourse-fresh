import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import crypto from 'node:crypto'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { optimizeTexture } from '@/lib/images/texture'
import { SECTION_DEF_BY_KEY, type SectionKey } from '@/lib/homepage/section-styles'
import { locales } from '@/lib/i18n/config'

// sharp needs the Node runtime (not edge); give it generous headroom even though
// the optimized pipeline finishes in well under a second.
export const runtime = 'nodejs'
export const maxDuration = 30

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
// The client downscales before upload, so this is just a backstop. Vercel's own
// request-body limit (~4.5MB) sits below this anyway.
const MAX_SIZE = 8 * 1024 * 1024

interface RouteParams {
  params: Promise<{ section: string }>
}

// POST /api/admin/homepage-styles/[section]/background — multipart { file }
// Optimizes the texture to a small WebP, stores it, and saves the URL + average
// colour on the section's style row.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { section } = await params
  if (!SECTION_DEF_BY_KEY[section as SectionKey]) return apiError('Unknown section', 404)

  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return apiError('No file provided', 400)
    if (file.type && !ALLOWED.includes(file.type)) return apiError('Use a JPEG, PNG, WebP, or AVIF image', 400)
    if (file.size > MAX_SIZE) return apiError('Texture too large — try a smaller image', 400)

    const input = Buffer.from(await file.arrayBuffer())

    let webp: Buffer, color: string
    try {
      ;({ webp, color } = await optimizeTexture(input))
    } catch {
      return apiError('Could not read that image. Try a JPEG or PNG.', 422)
    }

    const supabase = createAdminClient()
    const path = `${section}/${crypto.randomUUID()}.webp`
    const { error: upErr } = await supabase.storage.from('site-textures').upload(path, webp, {
      contentType: 'image/webp',
      upsert: false,
      cacheControl: 'public, max-age=31536000, immutable',
    })
    if (upErr) return apiError(`Storage upload failed: ${upErr.message}`)

    const webpUrl = supabase.storage.from('site-textures').getPublicUrl(path).data.publicUrl
    const background = { webp: webpUrl, color }

    const { data, error } = await supabase
      .from('homepage_section_styles')
      .upsert(
        { section_key: section, background, updated_at: new Date().toISOString() },
        { onConflict: 'section_key' },
      )
      .select('*')
      .single()
    if (error) return apiError(error.message)

    // Flush the cached homepage for every locale so the change is immediately visible.
    for (const locale of locales) revalidatePath(`/${locale}`)

    return apiOk({ background, row: data })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Upload failed', 500)
  }
}
