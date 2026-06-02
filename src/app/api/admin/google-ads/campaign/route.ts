import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { setCampaignStatus, updateCampaignBudget } from '@/lib/google-ads/campaigns'

/**
 * POST /api/admin/google-ads/campaign
 * Body: { campaignId, action: 'pause' | 'enable' | 'budget', eur? }
 *
 * Mutates an EXISTING campaign. We never create campaigns here (that stays in the
 * approval-gated chat/CLI flow). pause/lower-budget are safe; enable/raise-budget
 * can increase spend, so the UI confirms before calling.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const { campaignId, action, eur } = await request.json()
    if (!campaignId) return apiError('campaignId is required', 400)

    if (action === 'pause' || action === 'enable') {
      const res = await setCampaignStatus(String(campaignId), action === 'pause' ? 'PAUSED' : 'ENABLED')
      return res.ok ? apiOk({ campaignId, status: action === 'pause' ? 'PAUSED' : 'ENABLED' }) : apiError(res.error ?? 'Failed')
    }

    if (action === 'budget') {
      const amount = Number(eur)
      if (!(amount > 0)) return apiError('eur must be a positive number', 400)
      const res = await updateCampaignBudget(String(campaignId), amount)
      return res.ok ? apiOk({ campaignId, dailyBudgetEuros: amount }) : apiError(res.error ?? 'Failed')
    }

    return apiError('action must be pause, enable, or budget', 400)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
