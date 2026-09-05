import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { alertCronFailure } from '@/lib/cron/alert'
import { forwardReadyExpenses } from '@/lib/finance/expenses/forward-snelstart'

export const dynamic = 'force-dynamic'
/** Up to FORWARD_BATCH_LIMIT storage downloads + Gmail sends with attachments per run. */
export const maxDuration = 60

/**
 * GET /api/cron/finance-snelstart-forward — hourly.
 *
 * Every Expense Record that is `ready_for_snelstart` (payment + cost document
 * matched, VAT resolved without conflict) and not yet sent gets its ORIGINAL
 * document e-mailed to the bookkeeping mailbox, once. The switch
 * `finance_settings.snelstart_auto_forward` turns the whole pass off; a manual
 * "Doorsturen" from the UI still works then. Failures go to Beer's DM from
 * inside forwardReadyExpenses; a crash of the pass itself is a cron alert.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const result = await forwardReadyExpenses(supabase)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    await alertCronFailure('finance-snelstart-forward', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
