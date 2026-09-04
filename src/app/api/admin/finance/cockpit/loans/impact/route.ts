import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { computeCockpit } from '@/lib/finance/cockpit/compute'
import { loadCockpitInputs } from '@/lib/finance/cockpit/load-cockpit'
import { expandObligations, sumObligations } from '@/lib/finance/cockpit/obligations'
import { buildSchedule } from '@/lib/finance/cockpit/loans/schedule'
import { loanImpactSchema, parseBody } from '@/lib/finance/cockpit/schemas'
import type { CockpitInputs, LoanPaymentRow, ObligationOccurrence } from '@/lib/finance/cockpit/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/finance/cockpit/loans/impact — "what if I take this loan?"
 *
 * Nothing is saved. The cockpit is computed twice with the same formula: once
 * as-is, once with the loan's proceeds added to cleared cash (unless
 * proceeds_received=false) and its repayments added to the obligations inside
 * the horizon. Existing obligations are passed through untouched, never
 * re-expanded, so nothing is counted twice.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, loanImpactSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  let schedule
  try {
    schedule = buildSchedule({
      principalCents: body.principal_cents,
      interestRatePct: body.interest_rate_pct,
      durationYears: body.duration_years,
      interestFreeYears: body.interest_free_years,
      repaymentType: body.repayment_type,
      startDate: body.start_date,
      tranches: body.tranches?.map(t => ({ amountCents: t.amount_cents, date: t.date, note: t.note })),
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Could not build loan schedule', 400)
  }

  try {
    const { inputs } = await loadCockpitInputs({ horizon: body.horizon })
    const before = computeCockpit(inputs)

    const syntheticPayments: LoanPaymentRow[] = schedule.periods.map(p => ({
      id: `preview:${p.index}`,
      loanId: 'preview',
      loanName: body.name,
      dueDate: p.dueDate,
      interestCents: p.interestCents,
      principalCents: p.principalCents,
      totalCents: p.totalCents,
      isPaid: false,
    }))
    const added = expandObligations([], syntheticPayments, { today: inputs.today, horizon: inputs.horizon })

    const afterInputs: CockpitInputs = {
      ...inputs,
      cash: body.proceeds_received
        ? { ...inputs.cash, clearedCents: inputs.cash.clearedCents + body.principal_cents }
        : inputs.cash,
      obligations: sortByDue([...inputs.obligations, ...added]),
    }
    const after = computeCockpit(afterInputs)

    return apiOk({
      before,
      after,
      schedulePreview: schedule.periods.slice(0, 8),
      endDate: schedule.endDate,
      totalInterestCents: schedule.totalInterestCents,
      obligationsAddedInHorizonCents: sumObligations(added),
      belowSafetyMargin: after.financialSpaceCents < after.safetyMarginCents,
    })
  } catch (err) {
    console.error('[finance/cockpit/loans/impact]', err)
    return apiError(err instanceof Error ? err.message : 'Could not compute loan impact', 500)
  }
}

function sortByDue(list: ObligationOccurrence[]): ObligationOccurrence[] {
  return [...list].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.title.localeCompare(b.title)))
}
