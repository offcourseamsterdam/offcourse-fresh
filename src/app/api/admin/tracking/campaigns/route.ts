import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { slugify } from '@/lib/utils'

/**
 * GET /api/admin/tracking/campaigns
 * POST /api/admin/tracking/campaigns
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const partnerId = searchParams.get('partner_id')

    const supabase = createAdminClient()
    let query = supabase.from('campaigns').select('*').order('created_at', { ascending: false })

    if (partnerId) {
      query = query.eq('partner_id', partnerId)
    }

    const { data, error } = await query

    if (error) return apiError(error.message)
    return apiOk(data ?? [])
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, channel_id, partner_id, category, investment_type, investment_amount, percentage_value, notes, listing_id } = body

    if (!name) {
      return apiError('Name is required', 400)
    }

    const supabase = createAdminClient()
    const slug = slugify(name)

    // Derive category from channel slug if not explicitly provided
    let resolvedCategory = category
    if (!resolvedCategory && channel_id) {
      const { data: ch } = await supabase.from('channels').select('slug').eq('id', channel_id).maybeSingle()
      resolvedCategory = ch?.slug ?? 'other'
    }

    const { data, error } = await supabase
      .from('campaigns')
      .insert({
        name,
        slug,
        category: resolvedCategory || 'other',
        channel_id: channel_id ?? null,
        partner_id: partner_id ?? null,
        investment_type: investment_type ?? null,
        investment_amount: investment_amount ?? null,
        percentage_value: percentage_value ?? null,
        notes: notes ?? null,
        listing_id: listing_id ?? null,
      })
      .select()
      .single()

    if (error) return apiError(error.message)
    return apiOk(data, 201)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
