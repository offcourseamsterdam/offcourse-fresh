import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'

// GET /api/search?date=YYYY-MM-DD&guests=N
// Returns published cruise listings with real FareHarbor availability slots,
// filtered through each listing's 3-layer filter system.
// FH API calls are deduplicated per item PK — many listings share one FH item.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const date = searchParams.get('date')
  const guests = Number(searchParams.get('guests') ?? 2)

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return apiError('Invalid date', 400)
  }

  const results = await fetchSearchResults(date, guests)
  return apiOk({ results, date, guests })
}
