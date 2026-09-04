import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { addMonths, todayISO } from '@/lib/finance/cockpit/dates'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { accrueSkipperHours } from '@/lib/finance/cockpit/derived/skipper-hours'
import { monthsQuerySchema, parseQuery, skipperHoursConfirmSchema, parseBody } from '@/lib/finance/cockpit/schemas'
import { loadSkipperAccrualInputs } from './shared'

export const dynamic = 'force-dynamic'

const DEFAULT_MONTHS = 2

/**
 * GET /api/admin/finance/cockpit/obligations/derived/skipper-hours?months= (default 2)
 * What is owed to skippers from our own scheduling data — a sailed shift is a
 * debt the moment it ends, whether or not an invoice has arrived yet.
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
 * Confirms specific month+staff accruals into finance_obligations (kind: 'crew').
 * Idempotent via source_key ('skipper-hours:2026-08:<staffId>').
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
    const skipped: Array<{ key: string; reason: string }> = []

    for (const selection of parsed.data.selections) {
      const sourceKey = `skipper-hours:${selection.month}:${selection.staffId}`
      const accrual = result.months.find(m => m.month === selection.month && m.staffId === selection.staffId)
      if (!accrual) {
        skipped.push({ key: sourceKey, reason: 'Geen opgebouwde uren gevonden voor deze maand/schipper' })
        continue
      }
      if (accrual.unpricedHours > 0) {
        skipped.push({ key: sourceKey, reason: `${accrual.unpricedHours} uur zonder uurtarief — stel eerst een uurtarief in` })
        continue
      }

      const { data, error } = await supabase
        .from('finance_obligations')
        .insert({
          title: `${accrual.staffName} — uren ${selection.month}`,
          kind: 'crew',
          amount_cents: accrual.amountCents,
          due_date: accrual.dueDate,
          source_key: sourceKey,
          notes: `Automatisch berekend uit shifts en geklokte uren (${accrual.hours} uur).`,
          status: 'open',
        })
        .select('id')
        .single()

      if (error) {
        if (error.code === '23505') {
          skipped.push({ key: sourceKey, reason: 'already existed' })
          continue
        }
        return apiError(error.message, 500)
      }

      created.push({ key: sourceKey, id: data!.id })
      await logFinanceEvent(supabase, {
        event_type: 'obligation_created',
        actor: 'user',
        entity_type: 'obligation',
        entity_id: data!.id,
        delta_cents: accrual.amountCents,
        payload: { title: `${accrual.staffName} — uren ${selection.month}`, kind: 'crew', due_date: accrual.dueDate, source_key: sourceKey },
      })
    }

    return apiOk({ created, skipped })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/skipper-hours POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not confirm skipper-hours obligations', 500)
  }
}
