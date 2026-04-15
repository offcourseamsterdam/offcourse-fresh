import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/tracking/affiliates/[id]
 * PUT /api/admin/tracking/affiliates/[id]
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('partners').select('*').eq('id', id).single()
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
    .from('partners')
    .update({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.contact_name !== undefined && { contact_name: body.contact_name }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.website !== undefined && { website: body.website }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.is_active !== undefined && { is_active: body.is_active }),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiError(error.message)
  return apiOk(data)
}
