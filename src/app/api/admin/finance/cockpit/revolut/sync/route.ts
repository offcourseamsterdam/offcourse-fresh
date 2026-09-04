import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { createRevolutClient, loadConnection, isConnected } from '@/lib/revolut/token-store'
import { syncRevolut } from '@/lib/revolut/sync'

export const dynamic = 'force-dynamic'

/** POST: the "Ververs" button. Pulls balance + transactions now. */
export async function POST(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const row = await loadConnection(supabase)
    if (!isConnected(row)) return apiError('Revolut is niet gekoppeld', 400)
    const client = await createRevolutClient(supabase)
    const result = await syncRevolut(supabase, client)
    if (!result.ok) return apiError(result.error ?? 'Synchronisatie mislukt', 502)
    return apiOk(result)
  } catch (err) {
    return apiError((err as Error).message, 500)
  }
}
