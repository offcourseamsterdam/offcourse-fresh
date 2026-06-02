import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { listCampaigns, campaignPerformance } from '@/lib/google-ads/reporting'
import { getCampaignMarketingMap, listMarketingCampaigns } from '@/lib/google-ads/listings'
import { buildDashboardPayload, heroStats, funnelSteps } from '@/lib/google-ads/dashboard'

/**
 * GET /api/admin/google-ads?days=30
 *   → { days, hero, funnel, campaigns, marketingCampaigns, notConfigured? }
 *
 * Reads-only. Parallelizes the Google/DB calls for speed, then merges them through
 * the pure buildDashboardPayload pipeline. Each Google Ads campaign is connected to
 * a MARKETING campaign (the /t/ tracking rows); the listing is derived from that.
 * Dev-only ?demo=1 returns sample data so the visuals can be reviewed before a real
 * campaign exists.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(request.url)
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30))

  // ── Dev demo seam (never in production) ──
  if (url.searchParams.get('demo') === '1' && process.env.NODE_ENV !== 'production') {
    const { DEMO_CAMPAIGNS, DEMO_PERFORMANCE, DEMO_LINK_MAP, DEMO_MARKETING_CAMPAIGNS } = await import(
      '@/lib/google-ads/dashboard.fixtures'
    )
    const payload = buildDashboardPayload(DEMO_CAMPAIGNS, DEMO_PERFORMANCE, DEMO_LINK_MAP)
    return apiOk({ days, ...payload, marketingCampaigns: DEMO_MARKETING_CAMPAIGNS, demo: true })
  }

  try {
    const supabase = createAdminClient()

    const [campaignsRes, perfRes, linkMap, marketingCampaigns] = await Promise.all([
      listCampaigns(),
      campaignPerformance(days),
      getCampaignMarketingMap(supabase),
      listMarketingCampaigns(supabase),
    ])

    // If Google can't be reached/configured, still render the page gracefully.
    if (!campaignsRes.ok) {
      const msg = campaignsRes.error ?? 'Google Ads read failed'
      return apiOk({
        days,
        hero: heroStats([]),
        funnel: funnelSteps({ impressions: 0, clicks: 0, bookings: 0 }),
        campaigns: [],
        marketingCampaigns,
        error: msg,
        notConfigured: /not configured/i.test(msg),
      })
    }

    const payload = buildDashboardPayload(
      campaignsRes.rows ?? [],
      perfRes.ok ? (perfRes.rows ?? []) : [],
      linkMap,
    )
    return apiOk({ days, ...payload, marketingCampaigns, perfError: perfRes.ok ? undefined : perfRes.error })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
