import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { addMonths, todayISO } from '@/lib/finance/cockpit/dates'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { detectRecurring, proposalToObligation, type RecurringInput } from '@/lib/finance/cockpit/derived/recurring'
import { monthsQuerySchema, parseQuery, recurringConfirmSchema, parseBody } from '@/lib/finance/cockpit/schemas'

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

    const { data: txRows, error } = await supabase
      .from('bank_transactions')
      .select('id, amount_cents, created_at, merchant, counterparty, description, category, subcategory')
      .lt('amount_cents', 0)
      .eq('state', 'completed')
      .gte('created_at', since)
    if (error) return apiError(error.message, 500)

    const inputs: RecurringInput[] = (txRows ?? []).flatMap(r => {
      const merchant = r.merchant as { name?: string } | null
      const counterparty = r.counterparty as { name?: string } | null
      const label = merchant?.name ?? counterparty?.name ?? r.description
      if (!label) return []
      return [{
        id: r.id,
        label,
        date: (r.created_at as string).slice(0, 10),
        amountCents: Math.abs(r.amount_cents),
        category: r.category,
        subcategory: r.subcategory,
      }]
    })

    const { data: obligationRows, error: obligationsErr } = await supabase.from('finance_obligations').select('title')
    if (obligationsErr) return apiError(obligationsErr.message, 500)
    const existingLabels = (obligationRows ?? []).map(o => o.title)

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
    const skipped: Array<{ key: string; reason: string }> = []

    for (const selection of parsed.data.selections) {
      const obligation = proposalToObligation(selection.proposal, selection.kind)

      const { data, error } = await supabase
        .from('finance_obligations')
        .insert({
          title: obligation.title,
          kind: obligation.kind,
          amount_cents: obligation.amount_cents,
          due_date: obligation.due_date,
          recurrence_months: obligation.recurrence_months,
          source_key: selection.key,
          notes: obligation.notes,
          status: 'open',
        })
        .select('id')
        .single()

      if (error) {
        if (error.code === '23505') {
          skipped.push({ key: selection.key, reason: 'already existed' })
          continue
        }
        return apiError(error.message, 500)
      }

      created.push({ key: selection.key, id: data!.id })
      await logFinanceEvent(supabase, {
        event_type: 'obligation_created',
        actor: 'user',
        entity_type: 'obligation',
        entity_id: data!.id,
        delta_cents: obligation.amount_cents,
        payload: { title: obligation.title, kind: obligation.kind, due_date: obligation.due_date, source_key: selection.key },
      })
    }

    return apiOk({ created, skipped })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/recurring POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not confirm recurring obligations', 500)
  }
}
