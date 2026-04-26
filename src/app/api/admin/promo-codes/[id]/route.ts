import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET    /api/admin/promo-codes/[id] — get single code
 * PATCH  /api/admin/promo-codes/[id] — update (toggle active, update max_uses, valid_until, notes)
 * DELETE /api/admin/promo-codes/[id] — soft-delete (sets is_active = false)
 */

interface Props {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: Props) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('id', id)
      .single()

    if (error) return apiError(error.message, 404)
    return apiOk({ code: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function PATCH(request: NextRequest, { params }: Props) {
  try {
    const { id } = await params
    const body = await request.json()
    const allowed = ['is_active', 'max_uses', 'valid_until', 'valid_from', 'notes', 'label']
    const updates: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key]
    }

    if (Object.keys(updates).length === 0) {
      return apiError('No updatable fields provided', 400)
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('promo_codes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return apiError(error.message)
    return apiOk({ code: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('promo_codes')
      .update({ is_active: false })
      .eq('id', id)

    if (error) return apiError(error.message)
    return apiOk({ deleted: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
