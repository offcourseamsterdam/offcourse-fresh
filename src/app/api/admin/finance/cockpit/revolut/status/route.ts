import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRevolutEnvConfig, isConnected, loadConnection } from '@/lib/revolut/token-store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/finance/cockpit/revolut/status
 * Everything the "Koppel Revolut" card needs, without touching Revolut itself.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const env = getRevolutEnvConfig()
    const row = await loadConnection(supabase)
    const connected = isConnected(row)

    let latestBalance: { cents: number; takenAt: string } | null = null
    if (row.account_id) {
      const { data: snap } = await supabase
        .from('revolut_balance_snapshots')
        .select('balance_cents, taken_at')
        .eq('account_id', row.account_id)
        .order('taken_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (snap) latestBalance = { cents: snap.balance_cents, takenAt: snap.taken_at }
    }

    return apiOk({
      configured: Boolean(env),
      environment: env?.environment ?? row.environment,
      redirectUri: env?.redirectUri ?? row.redirect_uri,
      scopes: connected ? row.scopes : env?.scopes ?? [],
      connected,
      consentedAt: row.consented_at,
      accountId: row.account_id,
      accountName: row.account_name,
      lastSyncAt: row.last_sync_at,
      lastSyncError: row.last_sync_error,
      webhook: row.webhook_id ? { id: row.webhook_id, url: row.webhook_url } : null,
      latestBalance,
      tokenKeyConfigured: Boolean(process.env.REVOLUT_TOKEN_KEY),
    })
  } catch (err) {
    return apiError((err as Error).message, 500)
  }
}
