import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError } from '@/lib/api/response'

// GET /api/admin/partners — list all partners with campaign count + commission totals
export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data: partners, error } = await supabase
      .from('partners')
      .select('id, name, email, created_at')
      .order('name', { ascending: true })

    if (error) return apiError(error.message)

    // Count campaigns per partner
    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id, partner_id')
      .not('partner_id', 'is', null)

    const campaignsByPartner: Record<string, number> = {}
    for (const c of campaigns ?? []) {
      if (!c.partner_id) continue
      campaignsByPartner[c.partner_id] = (campaignsByPartner[c.partner_id] ?? 0) + 1
    }

    // Aggregate commission per partner from bookings
    const { data: totals } = await supabase
      .from('bookings')
      .select('partner_id, commission_amount_cents')
      .not('partner_id', 'is', null)

    const commissionByPartner: Record<string, number> = {}
    for (const row of totals ?? []) {
      if (!row.partner_id) continue
      commissionByPartner[row.partner_id] =
        (commissionByPartner[row.partner_id] ?? 0) + (row.commission_amount_cents ?? 0)
    }

    const enriched = (partners ?? []).map(p => ({
      ...p,
      campaign_count: campaignsByPartner[p.id] ?? 0,
      total_commission_cents: commissionByPartner[p.id] ?? 0,
    }))

    return apiOk({ partners: enriched })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

// POST /api/admin/partners — create a new partner
export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json()

    if (!name?.trim()) return apiError('Partner name is required', 400)

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('partners')
      .insert({ name: name.trim() })
      .select('id, name, created_at')
      .single()

    if (error) return apiError(error.message)
    return apiOk({ partner: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
