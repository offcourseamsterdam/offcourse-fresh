import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { getFilteredAvailability } from '@/lib/fareharbor/availability'
import type { SearchResult } from '@/types'

// GET /api/search?date=YYYY-MM-DD&guests=N
// Returns published cruise listings with real FareHarbor availability slots,
// filtered through each listing's 3-layer filter system.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const date = searchParams.get('date')
  const guests = Number(searchParams.get('guests') ?? 2)

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return apiError('Invalid date', 400)
  }

  const supabase = await createClient()

  const { data: listings, error } = await supabase
    .from('cruise_listings')
    .select('*')
    .eq('is_published', true)
    .order('display_order', { ascending: true })

  if (error) {
    return apiError('Failed to fetch listings')
  }

  // Fan out availability requests in parallel — one per listing.
  // Each listing is its own virtual product with its own filter config.
  const results: SearchResult[] = await Promise.all(
    (listings ?? []).map(async listing => {
      const { slots } = await getFilteredAvailability(listing.id, date, guests)
      return { listing, availableSlots: slots, date, guests }
    })
  )

  return apiOk({ results, date, guests })
}
