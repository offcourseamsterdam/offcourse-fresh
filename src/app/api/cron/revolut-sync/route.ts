import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { alertCronFailure } from '@/lib/cron/alert'
import { postSlackOps } from '@/lib/slack/send-notification'
import { createRevolutClient, loadConnection, isConnected, getRevolutEnvConfig } from '@/lib/revolut/token-store'
import { syncRevolut } from '@/lib/revolut/sync'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/revolut-sync — every 15 minutes (vercel.json).
 * The source of truth for cash: pulls the balance and the last 7 days of
 * transactions (state changes included). Webhooks only make this faster.
 * Alerts Beer's DM the first time a sync fails after a healthy run.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  const supabase = createAdminClient()
  try {
    const row = await loadConnection(supabase)
    if (!isConnected(row) || !getRevolutEnvConfig()) {
      return NextResponse.json({ ok: true, skipped: 'not_connected' })
    }
    const wasHealthy = !row.last_sync_error
    const client = await createRevolutClient(supabase)
    const result = await syncRevolut(supabase, client)
    if (!result.ok) {
      if (wasHealthy) await postSlackOps(`⚠️ Revolut-synchronisatie mislukt: ${result.error}`)
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 })
    }
    return NextResponse.json({ ...result, ok: true })
  } catch (err) {
    await alertCronFailure('revolut-sync', err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
