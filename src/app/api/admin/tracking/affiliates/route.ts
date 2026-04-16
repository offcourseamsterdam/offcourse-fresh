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
      const { data: links } = await supabase
        .from('campaign_links')
        .select('id, partner_id, commission_type, commission_percentage, fixed_commission_amount')

      const { data: clicks } = await supabase
        .from('campaign_clicks')
        .select('campaign_id')
        .gte('clicked_at', from)
        .lte('clicked_at', to)

      const { data: sessions } = await supabase
        .from('campaign_sessions')
        .select('campaign_id, converted, revenue_eur, booking_id')
        .gte('first_seen_at', from)
        .lte('first_seen_at', to)

      const enriched = partners.map((p) => {
        const partnerLinks = links?.filter((l) => l.partner_id === p.id) ?? []
        const linkIds = new Set(partnerLinks.map((l) => l.id))

        const totalClicks = clicks?.filter((c) => linkIds.has(c.campaign_id)).length ?? 0
        const partnerSessions = sessions?.filter((s) => linkIds.has(s.campaign_id)) ?? []
        const bookings = partnerSessions.filter((s) => s.converted)
        const revenue = bookings.reduce((sum, s) => sum + (s.revenue_eur ?? 0), 0)

        // Calculate commission
        let commission = 0
        for (const s of bookings) {
          const link = partnerLinks.find((l) => l.id === s.campaign_id)
          if (!link) continue
          if (link.commission_type === 'percentage' && link.commission_percentage) {
            commission += (s.revenue_eur ?? 0) * (link.commission_percentage / 100)
          } else if (link.commission_type === 'fixed_amount' && link.fixed_commission_amount) {
            commission += link.fixed_commission_amount / 100
          }
        }

        return {
          ...p,
          active_links: partnerLinks.filter((l) => true).length,
          total_clicks: totalClicks,
          total_sessions: partnerSessions.length,
          total_bookings: bookings.length,
          revenue_eur: revenue,
          commission_eur: commission,
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
