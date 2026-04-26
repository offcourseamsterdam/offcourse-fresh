import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/tracking/affiliates?from=...&to=...
 * Returns partners with performance metrics.
 *
 * POST /api/admin/tracking/affiliates
 * Creates a new partner/affiliate.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const supabase = createAdminClient()

    const { data: partners, error } = await supabase
      .from('partners')
      .select('*')
      .order('name')

    if (error) return apiError(error.message)

    // Enrich with metrics if date range provided
    if (from && to && partners?.length) {
      // Get all campaigns for these partners
      const partnerIds = partners.map((p) => p.id)
      const { data: campaigns } = await supabase
        .from('campaigns')
        .select('id, partner_id, percentage_value')
        .in('partner_id', partnerIds)

      const campaignIds = campaigns?.map((c) => c.id) ?? []

      // Count clicks per campaign (campaign_clicks.campaign_id = campaigns.id)
      const { data: clicks } = campaignIds.length
        ? await supabase
            .from('campaign_clicks')
            .select('campaign_id')
            .in('campaign_id', campaignIds)
            .gte('clicked_at', from)
            .lte('clicked_at', to)
        : { data: [] }

      // Get confirmed bookings attributed to these campaigns
      const { data: bookings } = campaignIds.length
        ? await supabase
            .from('bookings')
            .select('campaign_id, partner_id, base_amount_cents, commission_amount_cents, status')
            .in('campaign_id', campaignIds)
            .in('status', ['confirmed', 'completed'])
            .gte('created_at', from)
            .lte('created_at', to)
        : { data: [] }

      const enriched = partners.map((p) => {
        const partnerCampaigns = campaigns?.filter((c) => c.partner_id === p.id) ?? []
        const campaignIdSet = new Set(partnerCampaigns.map((c) => c.id))

        const totalClicks = clicks?.filter((c) => campaignIdSet.has(c.campaign_id)).length ?? 0
        const partnerBookings = bookings?.filter((b) => b.partner_id === p.id) ?? []
        const revenueEur = partnerBookings.reduce((sum, b) => sum + (b.base_amount_cents ?? 0), 0) / 100
        const commissionEur = partnerBookings.reduce((sum, b) => sum + (b.commission_amount_cents ?? 0), 0) / 100

        return {
          ...p,
          active_campaigns: partnerCampaigns.length,
          total_clicks: totalClicks,
          total_sessions: 0, // sessions table doesn't directly link to partners; use bookings as proxy
          total_bookings: partnerBookings.length,
          revenue_eur: revenueEur,
          commission_eur: commissionEur,
        }
      })

      return apiOk(enriched)
    }

    return apiOk(partners ?? [])
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, email, contact_name, phone, website, notes, channel_id } = body

    if (!name) return apiError('Name is required', 400)

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('partners')
      .insert({
        name,
        email: email ?? null,
        contact_name: contact_name ?? null,
        phone: phone ?? null,
        website: website ?? null,
        notes: notes ?? null,
        channel_id: channel_id ?? null,
      })
      .select()
      .single()

    if (error) return apiError(error.message)
    return apiOk(data, 201)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
