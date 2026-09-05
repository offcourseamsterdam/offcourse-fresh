import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayISO } from '@/lib/finance/cockpit/dates'
import { computeBtwDashboard } from '@/lib/finance/btw-dashboard-calculator'
import { vatObligations } from '@/lib/finance/cockpit/derived/vat'
import { upsertDerivedObligation } from '@/lib/finance/cockpit/derived/sync'
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
    const updated: Array<{ key: string; id: string }> = []
    const skipped: Array<{ key: string; reason: string }> = []

    for (const key of parsed.data.keys) {
      const proposal = proposalsByKey.get(key)
      if (!proposal) {
        skipped.push({ key, reason: 'Onbekende of niet meer geldige sleutel' })
        continue
      }

      const r = await upsertDerivedObligation(
        supabase,
        { key, title: proposal.title, kind: 'tax', amountCents: proposal.amountCents, dueDate: proposal.dueDate, notes: 'BTW-indicatie, automatisch berekend uit het kasboek' },
        'user',
      )
      if (r.status === 'created') created.push({ key: r.sourceKey, id: r.id! })
      else if (r.status === 'updated') updated.push({ key: r.sourceKey, id: r.id! })
      else skipped.push({ key: r.sourceKey, reason: r.reason! })
    }

    return apiOk({ created, updated, skipped })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/vat POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not confirm BTW obligations', 500)
  }
}
