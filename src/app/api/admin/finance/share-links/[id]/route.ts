import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/** DELETE /api/admin/finance/share-links/[id] — revoke a link. requireAdmin() ONLY. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('finance_share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return apiError(error.message)
  return apiOk({ revoked: true })
}
