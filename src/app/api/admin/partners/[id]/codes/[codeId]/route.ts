import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError } from '@/lib/api/response'

/**
 * PATCH /api/admin/partners/[id]/codes/[codeId] — revoke a partner code.
 * We never hard-delete: audit trail matters for invoiced bookings.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; codeId: string }> }
) {
  try {
    const { id, codeId } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('partner_codes')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', codeId)
      .eq('partner_id', id)
      .select('id, code, issued_at, expires_at, is_active, revoked_at, notes')
      .single()

    if (error) return apiError(error.message)
    return apiOk({ code: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
