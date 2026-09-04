import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayISO } from '@/lib/finance/cockpit/dates'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { computeBtwDashboard } from '@/lib/finance/btw-dashboard-calculator'
import { vatObligations } from '@/lib/finance/cockpit/derived/vat'
import { derivedConfirmKeysSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/finance/cockpit/obligations/derived/vat
 * Wraps the existing, already-battle-tested computeBtwDashboard() (nets 9%/21%
 * across every kasboek source) into obligation proposals — one per quarter that
 * actually owes money. A net refund quarter is never proposed.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const { quarters } = await computeBtwDashboard(supabase)
    const proposals = vatObligations(quarters, { today: todayISO() })
    return apiOk({ proposals })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/vat GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not compute BTW obligations', 500)
  }
}

/**
 * POST /api/admin/finance/cockpit/obligations/derived/vat {keys: string[]}
 * Confirms one or more proposed quarters into real finance_obligations rows.
 * Idempotent via source_key ('vat:2026-Q2').
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, derivedConfirmKeysSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { quarters } = await computeBtwDashboard(supabase)
    const proposals = vatObligations(quarters, { today: todayISO() })
    const proposalsByKey = new Map(proposals.map(p => [p.key, p]))

    const created: Array<{ key: string; id: string }> = []
    const skipped: Array<{ key: string; reason: string }> = []

    for (const key of parsed.data.keys) {
      const proposal = proposalsByKey.get(key)
      if (!proposal) {
        skipped.push({ key, reason: 'Onbekende of niet meer geldige sleutel' })
        continue
      }

      const { data, error } = await supabase
        .from('finance_obligations')
        .insert({
          title: proposal.title,
          kind: 'tax',
          amount_cents: proposal.amountCents,
          due_date: proposal.dueDate,
          source_key: key,
          notes: 'BTW-indicatie, automatisch berekend uit het kasboek',
          status: 'open',
        })
        .select('id')
        .single()

      if (error) {
        if (error.code === '23505') {
          skipped.push({ key, reason: 'already existed' })
          continue
        }
        return apiError(error.message, 500)
      }

      created.push({ key, id: data!.id })
      await logFinanceEvent(supabase, {
        event_type: 'obligation_created',
        actor: 'user',
        entity_type: 'obligation',
        entity_id: data!.id,
        delta_cents: proposal.amountCents,
        payload: { title: proposal.title, kind: 'tax', due_date: proposal.dueDate, source_key: key },
      })
    }

    return apiOk({ created, skipped })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/vat POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not confirm BTW obligations', 500)
  }
}
