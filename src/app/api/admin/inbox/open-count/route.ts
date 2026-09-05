import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyInboxScope, type InboxScope } from '@/lib/inbox/scope'

/**
 * GET /api/admin/inbox/open-count?scope=operations|finance — the sidebar
 * badges. Scoped so an unread skipper invoice doesn't make the customer
 * inbox look like a guest is waiting, and vice versa.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const scope: InboxScope = req.nextUrl.searchParams.get('scope') === 'finance' ? 'finance' : 'operations'
    const supabase = createAdminClient()
    const query = supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
    const { count, error } = await applyInboxScope(query, scope)
    if (error) return apiError(error.message)
    return apiOk({ count: count ?? 0 })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to count conversations')
  }
}
