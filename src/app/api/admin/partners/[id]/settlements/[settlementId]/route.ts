import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteParams {
  params: Promise<{ id: string; settlementId: string }>
}

// DELETE /api/admin/partners/[id]/settlements/[settlementId]
// Undo a settlement (admin recovery).
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id, settlementId } = await params
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('partner_settlements')
    .delete()
    .eq('id', settlementId)
    .eq('partner_id', id)
  if (error) return apiError(error.message)
  return apiOk({ deleted: true })
}
