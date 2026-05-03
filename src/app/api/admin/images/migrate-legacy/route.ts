import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

// Vercel Hobby caps at 300s. Migration scans all listings + inserts asset
// rows — typically completes in <60s for ~100 images.
export const maxDuration = 300

interface ScanResult {
  context: 'cruise' | 'extras' | 'hero'
  context_id: string | null
  url: string
}

/**
 * Scan all existing image-bearing tables and create image_assets records for any URLs
 * not yet linked to an asset. Returns the assets in 'pending' state — ready for
 * processing via /process-batch.
 *
 * Idempotent: skips URLs already linked to an asset (via SHA-256 dedup).
 */
export async function POST(_req: NextRequest) {
  try {
    const supabase = createAdminClient()

    // ── 1. Cruise listings ── images JSONB array + hero_image_url
    const { data: cruises } = await supabase
      .from('cruise_listings')
      .select('id, hero_image_url, images, hero_image_asset_id')

    const targets: ScanResult[] = []

    for (const c of cruises ?? []) {
      if (c.hero_image_url && !c.hero_image_asset_id) {
        targets.push({ context: 'cruise', context_id: c.id, url: c.hero_image_url })
      }
      const imgs = Array.isArray(c.images) ? c.images : []
      for (const img of imgs) {
        let url: string | undefined
        if (typeof img === 'string') {
          url = img
        } else if (img && typeof img === 'object' && !Array.isArray(img) && typeof (img as Record<string, unknown>).url === 'string') {
          url = (img as Record<string, string>).url
        }
        if (url) targets.push({ context: 'cruise', context_id: c.id, url })
      }
    }

    // ── 2. Extras ── image_url
    const { data: extras } = await supabase
      .from('extras')
      .select('id, image_url, image_asset_id')

    for (const e of extras ?? []) {
      if (e.image_url && !e.image_asset_id) {
        targets.push({ context: 'extras', context_id: e.id, url: e.image_url })
      }
    }

    // ── 3. Hero carousel items ── image_url
    const { data: heroes } = await supabase
      .from('hero_carousel_items')
      .select('id, image_url, image_asset_id')

    for (const h of heroes ?? []) {
      if (h.image_url && !h.image_asset_id) {
        targets.push({ context: 'hero', context_id: h.id, url: h.image_url })
      }
    }

    // ── Deduplicate URLs (some images appear across multiple records) ──
    const uniqueByUrl = new Map<string, ScanResult>()
    for (const t of targets) {
      if (!uniqueByUrl.has(t.url)) uniqueByUrl.set(t.url, t)
    }

    // ── For each unique URL: download, hash, create or link asset ──
    const created: string[] = []
    const linked: string[] = []
    const errors: { url: string; error: string }[] = []

    for (const target of uniqueByUrl.values()) {
      try {
        const res = await fetch(target.url)
        if (!res.ok) {
          errors.push({ url: target.url, error: `Fetch failed: ${res.status}` })
          continue
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

        // Check existing
        const { data: existing } = await supabase
          .from('image_assets')
          .select('id, status')
          .eq('sha256', sha256)
          .maybeSingle()

        if (existing) {
          linked.push(existing.id)
          continue
        }

        const { data: inserted, error: insertError } = await supabase
          .from('image_assets')
          .insert({
            context: target.context,
            context_id: target.context_id,
            original_url: target.url,
            mime_type: res.headers.get('content-type') ?? 'image/jpeg',
            file_size_bytes: buffer.length,
            sha256,
            status: 'pending',
          })
          .select('id')
          .single()

        if (insertError || !inserted) {
          errors.push({ url: target.url, error: insertError?.message ?? 'Insert failed' })
          continue
        }
        created.push(inserted.id)
      } catch (err) {
        errors.push({ url: target.url, error: err instanceof Error ? err.message : 'Unknown error' })
      }
    }

    return apiOk({
      scanned: uniqueByUrl.size,
      created: created.length,
      linked: linked.length,
      errors: errors.length,
      errorDetails: errors,
      newAssetIds: created,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
