import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { postSlackOps } from '@/lib/slack/send-notification'
import { alertCronFailure } from '@/lib/cron/alert'
import { addMonths, todayISO } from '@/lib/finance/cockpit/dates'
import { accrueSkipperHours } from '@/lib/finance/cockpit/derived/skipper-hours'
import { loadSkipperAccrualInputs, upsertSkipperAccrualObligation } from '@/app/api/admin/finance/cockpit/obligations/derived/skipper-hours/shared'

export const dynamic = 'force-dynamic'

/** How far back to recompute. Only CLOSED months are ever synced (see below); the extra
 * lookback just covers a cron that missed a run or two, not an intent to sync further back. */
const LOOKBACK_MONTHS = 3

/**
 * GET /api/cron/finance-sync-skipper-accrual — nightly.
 *
 * Beer, 2026-09-05: "the obligation should go automatically... I don't need
 * to confirm a specific month for a specific skipper to make it real." This
 * replaces the manual "Bevestigen" click for a CLOSED month (one that has
 * fully ended) — it computes the same live accrual the dashboard already
 * showed as a preview and syncs it into a real finance_obligations row via
 * the shared upsertSkipperAccrualObligation (idempotent, never touches a row
 * an approved invoice already reduced or settled).
 *
 * Deliberately only closed months (`accrual.isClosed`): the current month is
 * still accruing hour by hour, and turning that into a daily-updating
 * "obligation" — with a finance_events row every night — is a different,
 * noisier kind of automatic than what was asked for. The still-open month
 * stays a live preview on GET .../skipper-hours until it closes.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const today = todayISO()
    const since = addMonths(today, -LOOKBACK_MONTHS)
    const { shifts, timeEntries, bonuses, staff } = await loadSkipperAccrualInputs(supabase, since)
    const result = accrueSkipperHours(shifts, timeEntries, bonuses, staff, { today })

    const closed = result.months.filter(m => m.isClosed)
    let createdCount = 0
    let updatedCount = 0
    const blocked: string[] = []

    for (const accrual of closed) {
      const r = await upsertSkipperAccrualObligation(supabase, accrual, 'cron')
      if (r.status === 'created') createdCount++
      else if (r.status === 'updated') updatedCount++
      else if (r.reason?.includes('zonder uurtarief')) blocked.push(`${accrual.staffName} (${accrual.month})`)
    }

    if (createdCount > 0 || updatedCount > 0 || blocked.length > 0) {
      const lines = [`🧭 *Schippersuren gesynchroniseerd*`]
      if (createdCount > 0) lines.push(`• ${createdCount} nieuwe verplichting${createdCount === 1 ? '' : 'en'} aangemaakt`)
      if (updatedCount > 0) lines.push(`• ${updatedCount} bijgewerkt (uren of tarief gewijzigd)`)
      if (blocked.length > 0) lines.push(`• Zonder uurtarief, nog niet verwerkt: ${blocked.join(', ')}`)
      await postSlackOps(lines.join('\n'))
    }

    return NextResponse.json({ ok: true, closedMonthsChecked: closed.length, created: createdCount, updated: updatedCount, blocked: blocked.length })
  } catch (err) {
    await alertCronFailure('finance-sync-skipper-accrual', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
