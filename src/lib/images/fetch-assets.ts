import { createClient } from '@/lib/supabase/server'
import type { ImageAsset } from './types'

/**
 * Fetch all `image_assets` rows linked to a set of cruise listing IDs (by
 * context_id). Used by listing pages so we can do ONE batched query instead
 * of one per cruise — avoids the "N+1 query problem" (8 cruises = 8 round
 * trips to Supabase, vs. 1 round trip when batched).
 *
 * Returns a Map keyed by listing ID, where each value is the array of assets
 * belonging to that listing. Empty arrays for listings with no assets yet.
 */
export async function fetchAssetsForListings(listingIds: string[]): Promise<Map<string, ImageAsset[]>> {
  const map = new Map<string, ImageAsset[]>()
  for (const id of listingIds) map.set(id, [])

  if (listingIds.length === 0) return map

  const supabase = await createClient()
  const { data } = await supabase
    .from('image_assets')
    .select('*')
    .eq('context', 'cruise')
    .in('context_id', listingIds)
    .order('created_at', { ascending: true })

  for (const row of (data ?? []) as ImageAsset[]) {
    if (!row.context_id) continue
    const list = map.get(row.context_id)
    if (list) list.push(row)
  }
  return map
}

/** Fetch a single asset by ID, or null. */
export async function fetchAssetById(assetId: string | null | undefined): Promise<ImageAsset | null> {
  if (!assetId) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('image_assets')
    .select('*')
    .eq('id', assetId)
    .maybeSingle()
  return (data as ImageAsset | null) ?? null
}

/** Fetch many assets by ID — batched. Returns Map<id, asset>. */
export async function fetchAssetsByIds(assetIds: string[]): Promise<Map<string, ImageAsset>> {
  const map = new Map<string, ImageAsset>()
  if (assetIds.length === 0) return map
  const supabase = await createClient()
  const { data } = await supabase
    .from('image_assets')
    .select('*')
    .in('id', assetIds)
  for (const row of (data ?? []) as ImageAsset[]) {
    map.set(row.id, row)
  }
  return map
}
