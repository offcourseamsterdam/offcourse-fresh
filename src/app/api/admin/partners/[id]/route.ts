import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError } from '@/lib/api/response'

// GET /api/admin/partners/[id] — get a single partner by ID
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('partners')
      .select('id, name, email, contact_name, phone, website, commission_rate, is_active, created_at')
      .eq('id', id)
      .single()

    if (error) return apiError(error.message)
    return apiOk({ partner: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

// PATCH /api/admin/partners/[id] — update name or commission_rate
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const updates: Record<string, unknown> = {}
    if (body.name !== undefined) updates.name = String(body.name).trim()
    if (body.email !== undefined) updates.email = body.email ? String(body.email).trim() : null
    if (body.commission_rate !== undefined) updates.commission_rate = Number(body.commission_rate)

    if (Object.keys(updates).length === 0) return apiError('No fields to update', 400)

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('partners')
      .update(updates)
      .eq('id', id)
      .select('id, name, commission_rate, created_at')
      .single()

    if (error) return apiError(error.message)
    return apiOk({ partner: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

// DELETE /api/admin/partners/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const { error } = await supabase.from('partners').delete().eq('id', id)
    if (error) return apiError(error.message)
    return apiOk({ deleted: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
