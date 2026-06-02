import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { addNegativeKeywords } from '@/lib/google-ads/campaigns'

/**
 * POST /api/admin/google-ads/negatives
 * Body: { campaignId, terms: string[] }
 *
 * Adds campaign-level negative keywords (the one-click "block this search").
 * Safe: negatives only EXCLUDE traffic — they never increase spend.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const { campaignId, terms } = await request.json()
    if (!campaignId) return apiError('campaignId is required', 400)
    const list: string[] = Array.isArray(terms) ? terms.map(String).map(s => s.trim()).filter(Boolean) : []
    if (list.length === 0) return apiError('terms must be a non-empty array', 400)

    const res = await addNegativeKeywords(String(campaignId), list)
    return res.ok ? apiOk({ campaignId, added: list.length }) : apiError(res.error ?? 'Failed')
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
