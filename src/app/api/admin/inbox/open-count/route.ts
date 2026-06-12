import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/inbox/open-count — the sidebar badge.
 * Counts conversations that need us (status = open).
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const { count, error } = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
    if (error) return apiError(error.message)
    return apiOk({ count: count ?? 0 })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to count conversations')
  }
}
