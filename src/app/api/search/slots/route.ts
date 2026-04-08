import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { getFilteredAvailability } from '@/lib/fareharbor/availability'

// GET /api/search/slots?slug=...&date=YYYY-MM-DD&guests=N
// Returns FareHarbor availability slots for a single cruise listing,
// filtered through the listing's 3-layer filter system.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const slug = searchParams.get('slug')
  const date = searchParams.get('date')
  const guests = Number(searchParams.get('guests') ?? 2)

  if (!slug || !date) {
    return apiError('Missing slug or date', 400)
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return apiError('Invalid date format', 400)
  }

  // Look up the listing id from the slug (public anon client — is_published enforced by RLS)
  const supabase = await createClient()
  const { data: listing } = await supabase
    .from('cruise_listings')
    .select('id')
    .eq('slug', slug)
    .eq('is_published', true)
    .single()

  if (!listing) {
    return apiError('Listing not found', 404)
  }

  const { slots, reasonCode } = await getFilteredAvailability(listing.id, date, guests)

  return apiOk({ slots, slug, date, guests, reasonCode })
}
