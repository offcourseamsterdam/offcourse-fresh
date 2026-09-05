import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { addMonths, todayISO } from '@/lib/finance/cockpit/dates'
import { detectRecurring, proposalToObligation } from '@/lib/finance/cockpit/derived/recurring'
import { upsertDerivedObligation } from '@/lib/finance/cockpit/derived/sync'
import { monthsQuerySchema, parseQuery, recurringConfirmSchema, parseBody } from '@/lib/finance/cockpit/schemas'
import type { ObligationKind } from '@/lib/finance/cockpit/types'
import { loadRecurringInputs } from './shared'

export const dynamic = 'force-dynamic'

const DEFAULT_MONTHS = 6

/**
 * GET /api/admin/finance/cockpit/obligations/derived/recurring?months= (default 6)
 * Finds standing charges (insurance, berth, subscriptions) hiding in the bank
 * feed's outgoing, completed transactions. Names already covered by a manual
 * or confirmed obligation are excluded so nothing is proposed twice.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const months = parseQuery(request, 'months', monthsQuerySchema, DEFAULT_MONTHS)
  if (!months.ok) return months.response

  try {
    const supabase = createAdminClient()
    const since = addMonths(todayISO(), -months.data)
    const { inputs, existingLabels } = await loadRecurringInputs(supabase, since)
    const proposals = detectRecurring(inputs, { today: todayISO(), existingLabels })
    return apiOk({ proposals })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/recurring GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not detect recurring charges', 500)
  }
}

/**
 * POST /api/admin/finance/cockpit/obligations/derived/recurring
 * {selections: Array<{key, kind, proposal}>}
 *
 * Each selection carries the full proposal the GET returned (rather than just
 * its key) so confirming never re-derives from transactions that may have
 * changed since — what Beer saw is exactly what gets saved. Beer picks the
 * obligation kind per proposal (insurance vs. berth vs. contract, etc.).
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, recurringConfirmSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const created: Array<{ key: string; id: string }> = []
    const updated: Array<{ key: string; id: string }> = []
    const skipped: Array<{ key: string; reason: string }> = []

    for (const selection of parsed.data.selections) {
      const obligation = proposalToObligation(selection.proposal, selection.kind)

      const r = await upsertDerivedObligation(
        supabase,
        {
          key: selection.key,
          title: obligation.title,
          kind: obligation.kind as ObligationKind,
          amountCents: obligation.amount_cents,
          dueDate: obligation.due_date,
          recurrenceMonths: obligation.recurrence_months,
          notes: obligation.notes,
        },
        'user',
      )
      if (r.status === 'created') created.push({ key: r.sourceKey, id: r.id! })
      else if (r.status === 'updated') updated.push({ key: r.sourceKey, id: r.id! })
      else skipped.push({ key: r.sourceKey, reason: r.reason! })
    }

    return apiOk({ created, updated, skipped })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/recurring POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not confirm recurring obligations', 500)
  }
}
