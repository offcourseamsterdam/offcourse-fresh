import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { addMonths, todayISO } from '@/lib/finance/cockpit/dates'
import { accrueSkipperHours } from '@/lib/finance/cockpit/derived/skipper-hours'
import { monthsQuerySchema, parseQuery, skipperHoursConfirmSchema, parseBody } from '@/lib/finance/cockpit/schemas'
import { loadSkipperAccrualInputs, upsertSkipperAccrualObligation } from './shared'

export const dynamic = 'force-dynamic'

const DEFAULT_MONTHS = 2

/**
 * GET /api/admin/finance/cockpit/obligations/derived/skipper-hours?months= (default 2)
 * What is owed to skippers from our own scheduling data — a sailed shift is a
 * debt the moment it ends, whether or not an invoice has arrived yet.
 *
 * Returns every month in the window, open and closed alike — closed months
 * aren't filtered out here even though cron/finance-sync-skipper-accrual
 * (since 2026-09-05) already syncs them into real obligations automatically
 * every night. Beer's manual "Bevestigen" (POST below) stays live over this
 * same list on purpose: it's the fast path for "I just fixed a missing
 * hourly rate, sync this month now" instead of waiting for tonight's cron —
 * hiding a closed month here would take that away.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const months = parseQuery(request, 'months', monthsQuerySchema, DEFAULT_MONTHS)
  if (!months.ok) return months.response

  try {
    const supabase = createAdminClient()
    const since = addMonths(todayISO(), -months.data)
    const { shifts, timeEntries, bonuses, staff } = await loadSkipperAccrualInputs(supabase, since)
    const result = accrueSkipperHours(shifts, timeEntries, bonuses, staff, { today: todayISO() })
    return apiOk({ result })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/skipper-hours GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not compute skipper-hours accrual', 500)
  }
}

/**
 * POST /api/admin/finance/cockpit/obligations/derived/skipper-hours
 * {selections: Array<{month, staffId}>}
 *
 * Manually force a month+staff accrual into finance_obligations right now,
 * instead of waiting for the nightly auto-sync — useful right after fixing a
 * missing hourly rate, or to pull a still-open month in early. Closed months
 * no longer need this (2026-09-05: the cron does it automatically), but the
 * button stays: it's the same idempotent upsert either way (see shared.ts),
 * so clicking it is never wrong, just sometimes unnecessary.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, skipperHoursConfirmSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const earliestMonth = parsed.data.selections.reduce((min, s) => (s.month < min ? s.month : min), parsed.data.selections[0].month)
    const since = `${earliestMonth}-01`
    const { shifts, timeEntries, bonuses, staff } = await loadSkipperAccrualInputs(supabase, since)
    const result = accrueSkipperHours(shifts, timeEntries, bonuses, staff, { today: todayISO() })

    const created: Array<{ key: string; id: string }> = []
    const updated: Array<{ key: string; id: string }> = []
    const skipped: Array<{ key: string; reason: string }> = []

    for (const selection of parsed.data.selections) {
      const sourceKey = `skipper-hours:${selection.month}:${selection.staffId}`
      const accrual = result.months.find(m => m.month === selection.month && m.staffId === selection.staffId)
      if (!accrual) {
        skipped.push({ key: sourceKey, reason: 'Geen opgebouwde uren gevonden voor deze maand/schipper' })
        continue
      }

      const r = await upsertSkipperAccrualObligation(supabase, accrual, 'user')
      if (r.status === 'created') created.push({ key: r.sourceKey, id: r.id! })
      else if (r.status === 'updated') updated.push({ key: r.sourceKey, id: r.id! })
      else skipped.push({ key: r.sourceKey, reason: r.reason! })
    }

    return apiOk({ created, updated, skipped })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/skipper-hours POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not confirm skipper-hours obligations', 500)
  }
}
