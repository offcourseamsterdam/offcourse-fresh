import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/cruise-listings/[id]/extras?guestCount=4
 *
 * Returns all extras applicable to a listing:
 * - Global extras matching the listing's category (minus any disabled via listing_extras)
 * - Per-listing extras explicitly linked via listing_extras (is_enabled = true)
 *
 * Informational extras are included (shown as text cards in checkout, no price impact).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guestCount = Number(request.nextUrl.searchParams.get('guestCount') ?? 1)
  if (!Number.isFinite(guestCount) || guestCount < 1) {
    return apiError('guestCount must be a positive integer', 400)
  }
  const supabase = createAdminClient()

  const { data: listing, error: listingError } = await supabase
    .from('cruise_listings')
    .select('id, category, hero_image_url')
    .eq('id', id)
    .single()
  if (listingError) return apiError('Listing not found', 404)

  const { data: allExtras } = await supabase
    .from('extras')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const { data: overrides } = await supabase
    .from('listing_extras')
    .select('extra_id, is_enabled')
    .eq('listing_id', id)

  const overrideMap = new Map((overrides ?? []).map(o => [o.extra_id, o.is_enabled]))

  const resolved = (allExtras ?? []).filter(extra => {
    if (extra.scope === 'global') {
      if (!extra.applicable_categories?.includes(listing.category ?? '')) return false
      if (overrideMap.get(extra.id) === false) return false
      return true
    }
    return overrideMap.get(extra.id) === true
  })

  return apiOk({ extras: resolved, listing, guestCount })
}

/**
 * PATCH /api/admin/cruise-listings/[id]/extras
 * Body: { extraId: string, isEnabled: boolean }
 *
 * Creates or updates a listing_extras override/link record.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { extraId, isEnabled } = await request.json()
  if (!extraId || typeof isEnabled !== 'boolean') {
    return apiError('extraId and isEnabled are required', 400)
  }
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('listing_extras')
    .upsert(
      { listing_id: id, extra_id: extraId, is_enabled: isEnabled },
      { onConflict: 'listing_id,extra_id' }
    )

  if (error) return apiError(error.message)
  return apiOk({})
}
