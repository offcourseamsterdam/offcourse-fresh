import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/** GET /api/admin/finance/cockpit/goals/[id]/events — the goal's audit trail, newest first (max 100). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid goal id', 400)

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('finance_events')
      .select('*')
      .eq('entity_type', 'goal')
      .eq('entity_id', id)
      .order('occurred_at', { ascending: false })
      .limit(100)
    if (error) return apiError(error.message, 500)
    return apiOk(data ?? [])
  } catch (err) {
    console.error('[finance/cockpit/goals/[id]/events]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load goal events', 500)
  }
}
