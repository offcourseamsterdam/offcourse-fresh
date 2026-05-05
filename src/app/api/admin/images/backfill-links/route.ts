import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { linkAssetToSource } from '@/lib/images/processor'

export const maxDuration = 300

/**
 * POST /api/admin/images/backfill-links
 *
 * One-time repair: iterate all complete image_assets and write image_asset_id
 * back to the parent table (cruise_listings, extras, hero_carousel_items).
 *
 * Idempotent — already-linked records are left untouched by the .is(null) guards
 * in linkAssetToSource.
 */
export async function POST(_req: NextRequest) {
  try {
    const supabase = createAdminClient()

    const { data: assets, error } = await supabase
      .from('image_assets')
      .select('id, context, context_id, original_url')
      .eq('status', 'complete')
      .not('context_id', 'is', null)
      .not('original_url', 'is', null)
      .order('created_at', { ascending: true })

    if (error) return apiError(error.message)

    let linked = 0
    const errors: { id: string; error: string }[] = []

    for (const asset of assets ?? []) {
      try {
        await linkAssetToSource(supabase, asset.id, asset.context, asset.context_id, asset.original_url)
        linked++
      } catch (err) {
        errors.push({ id: asset.id, error: err instanceof Error ? err.message : String(err) })
      }
    }

    return apiOk({
      total: (assets ?? []).length,
      linked,
      errors: errors.length,
      errorDetails: errors,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
