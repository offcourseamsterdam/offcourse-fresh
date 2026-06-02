import { NextRequest } from 'next/server'
import { apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { searchTerms } from '@/lib/google-ads/reporting'

/**
 * GET /api/admin/google-ads/search-terms?campaign=<id>&days=30
 *   → { terms: SearchTermRow[] }   (the real queries that triggered ads)
 *
 * Powers the one-click negatives panel. Dev ?demo=1 returns sample junk queries.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(request.url)
  const campaign = url.searchParams.get('campaign') || undefined
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30))

  if (url.searchParams.get('demo') === '1' && process.env.NODE_ENV !== 'production') {
    return apiOk({
      terms: [
        { term: 'private boat tour amsterdam', impressions: 320, clicks: 28, conversions: 3, costEuros: 18 },
        { term: 'cheap boat amsterdam', impressions: 140, clicks: 9, conversions: 0, costEuros: 6 },
        { term: 'houseboat for sale amsterdam', impressions: 90, clicks: 4, conversions: 0, costEuros: 3 },
        { term: 'amsterdam ferry timetable', impressions: 70, clicks: 2, conversions: 0, costEuros: 1 },
      ],
      demo: true,
    })
  }

  const res = await searchTerms(campaign, days)
  return apiOk({ terms: res.ok ? res.rows : [], error: res.ok ? undefined : res.error })
}
