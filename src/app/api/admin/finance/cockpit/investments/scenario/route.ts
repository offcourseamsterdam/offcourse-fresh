import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCockpit } from '@/lib/finance/cockpit/compute'
import { loadCockpitInputs } from '@/lib/finance/cockpit/load-cockpit'
import { investmentScenarioSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/finance/cockpit/investments/scenario {investment_id | amount_cents, horizon?}
 *
 * "What would this leave me with?" — the same `computeCockpit`, run twice: once
 * on today's inputs, once with the spend taken off cleared cash. Deliberately
 * NOT a second formula (plan §2 rule 5): if the dashboard and this screen ever
 * disagreed, one of them would be lying, and there'd be no way to tell which.
 *
 * `affordable` is the honest question — not "is there enough cash" but "does it
 * still fit above the safety margin afterwards", which is exactly
 * `availableForGrowthCents`.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, investmentScenarioSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()

    let amountCents = parsed.data.amount_cents ?? 0
    let investment: { id: string; title: string; amount_cents: number } | null = null
    if (parsed.data.investment_id) {
      const { data, error } = await supabase
        .from('finance_investments')
        .select('id, title, amount_cents')
        .eq('id', parsed.data.investment_id)
        .maybeSingle()
      if (error) return apiError(error.message, 500)
      if (!data) return apiError('Investment not found', 404)
      investment = data
      // An explicit amount_cents wins, so the UI can model "what if it costs more".
      if (parsed.data.amount_cents === undefined) amountCents = data.amount_cents
    }

    const { inputs } = await loadCockpitInputs({ supabase, horizon: parsed.data.horizon })
    const before = computeCockpit(inputs)
    const after = computeCockpit({
      ...inputs,
      cash: { ...inputs.cash, clearedCents: inputs.cash.clearedCents - amountCents },
    })

    return apiOk({
      amountCents,
      investment,
      affordable: amountCents <= before.availableForGrowthCents,
      before,
      after,
      delta: {
        financialSpaceCents: after.financialSpaceCents - before.financialSpaceCents,
        availableForGrowthCents: after.availableForGrowthCents - before.availableForGrowthCents,
        marginShortfallCents: after.marginShortfallCents - before.marginShortfallCents,
      },
    })
  } catch (err) {
    console.error('[finance/cockpit/investments/scenario]', err)
    return apiError(err instanceof Error ? err.message : 'Could not compute scenario', 500)
  }
}
