import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { createRevolutClient, disconnect, loadConnection, isConnected } from '@/lib/revolut/token-store'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'

export const dynamic = 'force-dynamic'

/** POST: forget tokens + webhook. Synced transactions and snapshots are kept (history). */
export async function POST(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const row = await loadConnection(supabase)
    if (isConnected(row) && row.webhook_id) {
      try {
        const client = await createRevolutClient(supabase)
        await client.deleteWebhook(row.webhook_id)
      } catch { /* best effort */ }
    }
    await disconnect(supabase)
    await logFinanceEvent(supabase, { event_type: 'revolut_disconnected', actor: 'user', entity_type: 'revolut', entity_id: null, payload: {} })
    return apiOk({ disconnected: true })
  } catch (err) {
    return apiError((err as Error).message, 500)
  }
}
