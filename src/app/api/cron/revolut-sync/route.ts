import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { alertCronFailure } from '@/lib/cron/alert'
import { postSlackOps } from '@/lib/slack/send-notification'
import { createRevolutClient, loadConnection, isConnected, getRevolutEnvConfig } from '@/lib/revolut/token-store'
import { syncRevolut } from '@/lib/revolut/sync'
import { ensureExpensesForTransactions, syncRevolutExpenses, type EnsureResult, type ExpenseSyncResult } from '@/lib/finance/expenses/sync-revolut'
import { matchOrphanDocuments, type MatchOutcome } from '@/lib/finance/expenses/match-orchestrator'

export const dynamic = 'force-dynamic'
/** Cash sync + expense records + receipts + orphan matching in one run; the receipt step has its own 25 s budget inside this. */
export const maxDuration = 60

const EXPENSE_LOOKBACK_DAYS = 30

/**
 * GET /api/cron/revolut-sync — every 15 minutes (vercel.json).
 * The source of truth for cash: pulls the balance and the last 7 days of
 * transactions (state changes included). Webhooks only make this faster.
 * Alerts Beer's DM the first time a sync fails after a healthy run.
 *
 * Then the Finance Inbox v2 step (plan §3.1): every completed outgoing
 * transaction gets its Expense Record, and Revolut's own expenses/receipts
 * are pulled onto them. Kept behind its own try/catch — a Gemini hiccup or
 * an expenses-endpoint error must never fail the cash sync the whole cockpit
 * depends on; it's reported in the response and logged instead.
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

    let expenses: { ensured: EnsureResult; synced: ExpenseSyncResult; matched: Record<MatchOutcome, number> } | { error: string } | undefined
    if (result.accountId) {
      try {
        const since = new Date(Date.now() - EXPENSE_LOOKBACK_DAYS * 86_400_000).toISOString()
        const ensured = await ensureExpensesForTransactions(supabase, { accountId: result.accountId, since })
        const synced = await syncRevolutExpenses(supabase, client, { since })
        // New payments may be exactly what an orphan invoice/receipt was waiting for (plan §4.2, direction 2).
        const matched = await matchOrphanDocuments(supabase)
        expenses = { ensured, synced, matched }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[cron/revolut-sync] expense step failed:', message)
        expenses = { error: message }
      }
    }
    return NextResponse.json({ ...result, ok: true, expenses })
  } catch (err) {
    await alertCronFailure('revolut-sync', err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
