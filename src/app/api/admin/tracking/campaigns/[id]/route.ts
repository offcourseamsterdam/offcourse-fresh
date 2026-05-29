import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/tracking/campaigns/[id]
 * PUT /api/admin/tracking/campaigns/[id]
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('campaigns').select('*').eq('id', id).single()
  if (error) return apiError(error.message, 404)
  return apiOk(data)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await request.json()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('campaigns')
    .update({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.channel_id !== undefined && { channel_id: body.channel_id }),
      ...(body.partner_id !== undefined && { partner_id: body.partner_id }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.investment_type !== undefined && { investment_type: body.investment_type }),
      ...(body.investment_amount !== undefined && { investment_amount: body.investment_amount }),
      ...(body.percentage_value !== undefined && { percentage_value: body.percentage_value }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.is_active !== undefined && { is_active: body.is_active }),
      // Destination repointing — enables the "create placeholder campaign first,
      // assign cruise after it's created" workflow for partner-invoice listings.
      ...(body.listing_id !== undefined && { listing_id: body.listing_id }),
      // Settlement direction: 'affiliate' (we owe partner) or 'reseller' (partner owes us).
      ...(body.settlement_model !== undefined && {
        settlement_model: body.settlement_model === 'reseller' ? 'reseller' : 'affiliate',
      }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiError(error.message)
  return apiOk(data)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('campaigns').delete().eq('id', id)
  if (error) return apiError(error.message)
  return apiOk({ deleted: true })
}
