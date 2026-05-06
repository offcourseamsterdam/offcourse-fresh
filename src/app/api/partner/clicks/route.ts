import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/clicks?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns click analytics for the authenticated partner, filtered by date range.
 *
 * - total_clicks       — rows in campaign_clicks for this partner's campaigns
 * - unique_visitors    — distinct visitor_id values in analytics_sessions attributed
 *                        to this partner's campaigns
 * - by_campaign        — same metrics broken down per campaign
 *
 * Defaults to the last 30 days when no params are supplied.
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    // Parse date range from query string, defaulting to last 30 days
    const { searchParams } = new URL(request.url)
    const toDate = searchParams.get('to') || todayStr()
    const fromDate = searchParams.get('from') || daysAgoStr(29, toDate)

    // from/to are inclusive dates in the partner's timezone (no TZ info →
    // we treat them as UTC day boundaries which is fine for daily granularity)
    const fromTs = `${fromDate}T00:00:00`
    const toTs   = `${toDate}T23:59:59`

    const admin = createAdminClient()

    // Get all campaigns for this partner
    const { data: campaigns, error: campaignsError } = await admin
      .from('campaigns')
      .select('id, name, slug, is_active, percentage_value')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })

    if (campaignsError) return apiError(campaignsError.message)
    if (!campaigns || campaigns.length === 0) {
      return apiOk({
        from: fromDate,
        to: toDate,
        total_clicks: 0,
        unique_visitors: 0,
        by_campaign: [],
      })
    }

    const campaignIds = campaigns.map(c => c.id)

    // Fetch raw clicks (campaign_id + clicked_at)
    const { data: clicks, error: clicksError } = await admin
      .from('campaign_clicks')
      .select('campaign_id, clicked_at')
      .in('campaign_id', campaignIds)
      .gte('clicked_at', fromTs)
      .lte('clicked_at', toTs)

    if (clicksError) return apiError(clicksError.message)

    // Fetch unique visitors from analytics_sessions using distinct visitor_id
    const { data: sessions, error: sessionsError } = await admin
      .from('analytics_sessions')
      .select('campaign_id, visitor_id')
      .in('campaign_id', campaignIds)
      .gte('started_at', fromTs)
      .lte('started_at', toTs)

    if (sessionsError) return apiError(sessionsError.message)

    // Aggregate clicks per campaign
    const clicksMap: Record<string, number> = {}
    for (const c of clicks ?? []) {
      if (!c.campaign_id) continue
      clicksMap[c.campaign_id] = (clicksMap[c.campaign_id] ?? 0) + 1
    }

    // Aggregate unique visitors per campaign
    const visitorsMap: Record<string, Set<string>> = {}
    for (const s of sessions ?? []) {
      if (!s.campaign_id || !s.visitor_id) continue
      if (!visitorsMap[s.campaign_id]) visitorsMap[s.campaign_id] = new Set()
      visitorsMap[s.campaign_id].add(s.visitor_id)
    }

    // Build per-campaign breakdown
    const byCampaign = campaigns.map(c => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      is_active: c.is_active,
      commission_rate: c.percentage_value ?? null,
      clicks: clicksMap[c.id] ?? 0,
      unique_visitors: visitorsMap[c.id]?.size ?? 0,
    }))

    // Overall totals
    const totalClicks = Object.values(clicksMap).reduce((s, n) => s + n, 0)
    // Unique visitors across all campaigns (de-duplicate visitor_ids globally)
    const allVisitors = new Set<string>()
    for (const set of Object.values(visitorsMap)) {
      for (const v of set) allVisitors.add(v)
    }

    return apiOk({
      from: fromDate,
      to: toDate,
      total_clicks: totalClicks,
      unique_visitors: allVisitors.size,
      by_campaign: byCampaign,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoStr(days: number, baseDate: string): string {
  const d = new Date(`${baseDate}T00:00:00`)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}
