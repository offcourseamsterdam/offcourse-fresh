import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { postSlackOps } from '@/lib/slack/send-notification'
import { alertCronFailure } from '@/lib/cron/alert'
import { computeCockpit } from '@/lib/finance/cockpit/compute'
import { loadCockpitInputs } from '@/lib/finance/cockpit/load-cockpit'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { formatAllocationSummary, planMonthlyAllocation } from '@/lib/finance/cockpit/allocation'
import { todayISO } from '@/lib/finance/cockpit/dates'
import type { BucketKey, GoalRow } from '@/lib/finance/cockpit/types'

/**
 * GET /api/cron/finance-monthly-allocation — 1st of the month, 06:00 (vercel.json).
 *
 * Tops up the two stored planning buffers (owner-salary coverage and each
 * goal's funded_cents) out of the money above the safety margin. The maths
 * lives in cockpit/allocation.ts and is pure; this route is the I/O around it.
 *
 * Three safeguards, because this moves planning money unattended:
 *
 * 1. **Once per month.** An `allocation_applied` event is written at the end;
 *    a second run in the same calendar month sees it and does nothing. A cron
 *    retry (or a curious manual trigger) must never allocate twice.
 * 2. **Absolute writes, not increments.** Each update writes the `toCents` the
 *    plan computed from one consistent snapshot, so a partially-applied run
 *    that gets retried lands on the same numbers instead of compounding.
 * 3. **Conflict-safe.** Each update is conditional on the value the plan read
 *    (`.eq('funded_cents', fromCents)`). If Beer edited a goal between the read
 *    and the write, that row is left exactly as he left it and reported as
 *    skipped rather than silently overwritten.
 *
 * `?dryRun=1` computes and returns the plan (and its Slack text) without
 * writing anything — same convention as the catering auto-send cron.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1'

  try {
    const supabase = createAdminClient()
    const today = todayISO()
    const monthStart = `${today.slice(0, 7)}-01`

    if (!dryRun) {
      const { data: already } = await supabase
        .from('finance_events')
        .select('id, occurred_at')
        .eq('event_type', 'allocation_applied')
        .gte('occurred_at', `${monthStart}T00:00:00.000Z`)
        .limit(1)
      if (already?.length) {
        return NextResponse.json({ ok: true, alreadyRan: true, month: today.slice(0, 7), allocatedCents: 0 })
      }
    }

    const [{ inputs, settings }, goalsRes] = await Promise.all([
      loadCockpitInputs({ supabase, today }),
      supabase
        .from('finance_goals')
        .select('id, name, target_cents, funded_cents, deadline, priority, monthly_funding_cents, status, created_at, boat_id')
        .eq('status', 'active'),
    ])
    if (goalsRes.error) throw new Error(goalsRes.error.message)

    const goals: GoalRow[] = (goalsRes.data ?? []).map(r => ({
      id: r.id,
      name: r.name,
      targetCents: r.target_cents,
      fundedCents: r.funded_cents,
      deadline: r.deadline,
      priority: r.priority,
      monthlyFundingCents: r.monthly_funding_cents,
      status: r.status as GoalRow['status'],
      createdAt: r.created_at.slice(0, 10),
      boatId: r.boat_id,
    }))

    const cockpit = computeCockpit(inputs)
    const plan = planMonthlyAllocation(cockpit, goals, {
      ownerSalaryMonthlyCents: settings.owner_salary_monthly_cents,
      ownerSalaryMonths: settings.owner_salary_months,
      ownerSalaryCoverageCents: settings.owner_salary_coverage_cents,
      priority: Array.isArray(settings.allocation_priority) ? (settings.allocation_priority as BucketKey[]) : undefined,
      marketingReservePct: settings.marketing_reserve_pct,
    })

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, month: today.slice(0, 7), plan, summary: formatAllocationSummary(plan, { dryRun: true }) })
    }

    // Claim the month BEFORE any money moves, with a checked insert — not
    // through logFinanceEvent, which is best-effort by design and swallows its
    // own failures. If the claim cannot be written we must not allocate: a
    // missing marker means the next run would happily allocate a second time.
    // Fail-closed — a skipped month is visible and recoverable; a double
    // allocation silently inflates every buffer.
    const { error: claimError } = await supabase.from('finance_events').insert({
      event_type: 'allocation_applied',
      actor: 'cron',
      entity_type: 'settings',
      entity_id: null, // finance_events.entity_id is uuid; the settings row's text id lives in payload, same as settings/route.ts
      delta_cents: plan.allocatedCents,
      payload: {
        month: today.slice(0, 7),
        availableCents: plan.availableCents,
        plannedCents: plan.allocatedCents,
        deltas: plan.deltas.map(d => ({ kind: d.kind, goalId: d.goalId ?? null, label: d.label, deltaCents: d.deltaCents, fromCents: d.fromCents, toCents: d.toCents })),
        skipped: plan.skipped.length,
      },
    })
    if (claimError) throw new Error(`Could not claim the month, refusing to allocate: ${claimError.message}`)

    let appliedCents = 0
    const conflicts: string[] = []

    for (const delta of plan.deltas) {
      if (delta.kind === 'goal' && delta.goalId) {
        const { data: updated, error } = await supabase
          .from('finance_goals')
          .update({ funded_cents: delta.toCents })
          .eq('id', delta.goalId)
          .eq('funded_cents', delta.fromCents) // untouched since the plan read it
          .select('id')
        if (error) throw new Error(error.message)
        if (!updated?.length) {
          conflicts.push(delta.label)
          continue
        }
        appliedCents += delta.deltaCents
        await logFinanceEvent(supabase, {
          event_type: 'goal_funding_changed',
          actor: 'cron',
          entity_type: 'goal',
          entity_id: delta.goalId,
          delta_cents: delta.deltaCents,
          payload: { before: delta.fromCents, after: delta.toCents, reason: 'monthly_allocation', month: today.slice(0, 7) },
        })
      } else if (delta.kind === 'owner_salary') {
        const { data: updated, error } = await supabase
          .from('finance_settings')
          .update({ owner_salary_coverage_cents: delta.toCents })
          .eq('id', 'default')
          .eq('owner_salary_coverage_cents', delta.fromCents)
          .select('id')
        if (error) throw new Error(error.message)
        if (!updated?.length) {
          conflicts.push(delta.label)
          continue
        }
        appliedCents += delta.deltaCents
        await logFinanceEvent(supabase, {
          event_type: 'owner_salary_coverage_changed',
          actor: 'cron',
          entity_type: 'settings',
          entity_id: null, // finance_events.entity_id is uuid; the settings row's text id lives in payload, same as settings/route.ts
          delta_cents: delta.deltaCents,
          payload: { before: delta.fromCents, after: delta.toCents, reason: 'monthly_allocation', month: today.slice(0, 7) },
        })
      }
    }

    // What actually landed, when it differs from what was claimed. The claim
    // above says what this run intended; the per-goal goal_funding_changed
    // events say what moved. This third event only exists when a row was
    // changed underneath us, so the difference is never silent.
    if (conflicts.length > 0) {
      await logFinanceEvent(supabase, {
        event_type: 'allocation_conflicted',
        actor: 'cron',
        entity_type: 'settings',
        entity_id: null, // finance_events.entity_id is uuid; the settings row's text id lives in payload, same as settings/route.ts
        delta_cents: appliedCents,
        payload: { month: today.slice(0, 7), plannedCents: plan.allocatedCents, appliedCents, conflicts },
      })
    }

    const summary = formatAllocationSummary(plan)
    if (summary) {
      const withConflicts = conflicts.length
        ? `${summary}\n\n⚠️ Tussentijds gewijzigd, niet aangepast: ${conflicts.join(', ')}.`
        : summary
      await postSlackOps(withConflicts)
    }

    return NextResponse.json({
      ok: true,
      month: today.slice(0, 7),
      availableCents: plan.availableCents,
      allocatedCents: appliedCents,
      deltas: plan.deltas.length,
      conflicts,
    })
  } catch (err) {
    await alertCronFailure('finance-monthly-allocation', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
