import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { enforceRateLimit } from '@/lib/rate-limit'
import { getFilteredAvailabilityBySlug } from '@/lib/fareharbor/availability'

// GET /api/search/slots?slug=...&date=YYYY-MM-DD&guests=N
// Returns FareHarbor availability slots for a single cruise listing,
// filtered through the listing's 3-layer filter system.
export async function GET(request: NextRequest) {
  // One FareHarbor call per request — cap abuse of the shared FH quota.
  const limited = enforceRateLimit(request, 'search-slots', 60, 60_000)
  if (limited) return limited

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

  // Looks the listing up by slug (enforcing is_published) AND fetches filter
  // config in one query — no separate slug→id round-trip before this.
  const { slots, reasonCode } = await getFilteredAvailabilityBySlug(slug, date, guests)

  if (reasonCode === 'LISTING_NOT_FOUND') {
    return apiError('Listing not found', 404)
  }

  return apiOk({ slots, slug, date, guests, reasonCode })
}
