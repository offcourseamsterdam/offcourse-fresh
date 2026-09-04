/**
 * The monthly allocation plan: which stored buffers get topped up, and by how
 * much, from money that is genuinely free.
 *
 * Two stored planning figures exist (plan §2.1): the owner-salary buffer and
 * each goal's `funded_cents`. Neither is derived — they only move on an
 * explicit event, and this is one of the three (Beer edits, this cron, or a
 * linked purchase completes a goal).
 *
 * THE POT IS `availableForGrowthCents`, NOT `freeCents`. This is the single
 * most important decision in this file. `freeCents` is cash no bucket has
 * claimed yet — but part of it is standing behind the safety margin. The
 * margin is a threshold, not a bucket (compute.ts), so nothing subtracts it
 * for us. Allocating out of `freeCents` would let an unattended cron quietly
 * push the business under its own safety margin every first of the month,
 * which is precisely the line this module must never cross. Allocating out of
 * `availableForGrowthCents` means: after the plan is applied, financial space
 * is still at or above the margin. That invariant is asserted in the tests.
 *
 * Pure: integer cents in, integer cents out, no division anywhere, so there is
 * nothing to round and nothing to drift.
 */

import type { BucketKey, CockpitResult, GoalRow } from './types'

export interface AllocationSettings {
  ownerSalaryMonthlyCents: number
  ownerSalaryMonths: number
  ownerSalaryCoverageCents: number
  /** Only the relative order of 'owner_salary' vs 'goals' matters here; the other buckets are computed requirements, not buffers anyone tops up. */
  priority?: BucketKey[]
}

export type AllocationTargetKind = 'owner_salary' | 'goal'

export interface AllocationDelta {
  kind: AllocationTargetKind
  /** Set for kind 'goal'. */
  goalId?: string
  label: string
  /** Always > 0. */
  deltaCents: number
  fromCents: number
  toCents: number
  /** 'target' = it reached its target; 'available' = the pot ran out first. */
  cappedBy?: 'target' | 'available'
}

export type SkipReason = 'complete' | 'no_plan' | 'no_room'

export interface AllocationSkip {
  kind: AllocationTargetKind
  goalId?: string
  label: string
  wantedCents: number
  reason: SkipReason
}

export interface AllocationPlan {
  /** The money this plan is allowed to touch: everything above the safety margin. */
  availableCents: number
  allocatedCents: number
  /** availableCents − allocatedCents. */
  remainingCents: number
  deltas: AllocationDelta[]
  skipped: AllocationSkip[]
}

const SKIP_LABELS: Record<SkipReason, string> = {
  complete: 'doel is al vol',
  no_plan: 'geen maandbedrag ingesteld',
  no_room: 'geen ruimte meer boven de veiligheidsmarge',
}

/**
 * Deterministic order: priority ascending (1 = most important, matching
 * load-cockpit's own sort), then the nearest deadline, then name. A goal
 * without a deadline sorts after one with the same priority that has one —
 * a dated goal is the more urgent commitment.
 */
function byGoalUrgency(a: GoalRow, b: GoalRow): number {
  if (a.priority !== b.priority) return a.priority - b.priority
  if (a.deadline !== b.deadline) {
    if (!a.deadline) return 1
    if (!b.deadline) return -1
    return a.deadline < b.deadline ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}

export function planMonthlyAllocation(
  cockpit: CockpitResult,
  goals: GoalRow[],
  settings: AllocationSettings,
): AllocationPlan {
  const availableCents = Math.max(0, cockpit.availableForGrowthCents)
  let pot = availableCents
  const deltas: AllocationDelta[] = []
  const skipped: AllocationSkip[] = []

  const salaryFirst = ordersSalaryFirst(settings.priority)

  const runSalary = () => {
    const target = Math.max(0, settings.ownerSalaryMonthlyCents) * Math.max(0, settings.ownerSalaryMonths)
    const from = Math.max(0, settings.ownerSalaryCoverageCents)
    const deficit = Math.max(0, target - from)
    if (deficit === 0) {
      // Nothing to say when no salary is configured at all — only report a
      // real, already-full buffer.
      if (target > 0) skipped.push({ kind: 'owner_salary', label: 'Eigenaarssalaris', wantedCents: 0, reason: 'complete' })
      return
    }
    if (pot === 0) {
      skipped.push({ kind: 'owner_salary', label: 'Eigenaarssalaris', wantedCents: deficit, reason: 'no_room' })
      return
    }
    const delta = Math.min(deficit, pot)
    pot -= delta
    deltas.push({
      kind: 'owner_salary',
      label: 'Eigenaarssalaris',
      deltaCents: delta,
      fromCents: from,
      toCents: from + delta,
      cappedBy: delta === deficit ? 'target' : 'available',
    })
  }

  const runGoals = () => {
    for (const goal of [...goals].sort(byGoalUrgency)) {
      const from = Math.max(0, goal.fundedCents)
      const remainingToTarget = Math.max(0, goal.targetCents - from)
      if (remainingToTarget === 0) {
        skipped.push({ kind: 'goal', goalId: goal.id, label: goal.name, wantedCents: 0, reason: 'complete' })
        continue
      }
      // No monthly amount = no plan. The cron never invents one; Beer sets it
      // (or funds the goal by hand) — same "never silently invent" rule the
      // invoice extractor follows.
      const monthly = Math.max(0, goal.monthlyFundingCents)
      if (monthly === 0) {
        skipped.push({ kind: 'goal', goalId: goal.id, label: goal.name, wantedCents: 0, reason: 'no_plan' })
        continue
      }
      const wanted = Math.min(monthly, remainingToTarget)
      if (pot === 0) {
        skipped.push({ kind: 'goal', goalId: goal.id, label: goal.name, wantedCents: wanted, reason: 'no_room' })
        continue
      }
      const delta = Math.min(wanted, pot)
      pot -= delta
      deltas.push({
        kind: 'goal',
        goalId: goal.id,
        label: goal.name,
        deltaCents: delta,
        fromCents: from,
        toCents: from + delta,
        cappedBy: delta === wanted ? (wanted === remainingToTarget ? 'target' : undefined) : 'available',
      })
    }
  }

  if (salaryFirst) {
    runSalary()
    runGoals()
  } else {
    runGoals()
    runSalary()
  }

  const allocatedCents = deltas.reduce((s, d) => s + d.deltaCents, 0)
  return { availableCents, allocatedCents, remainingCents: availableCents - allocatedCents, deltas, skipped }
}

/** Default priority puts owner_salary before goals; an explicit list can flip it. */
function ordersSalaryFirst(priority?: BucketKey[]): boolean {
  if (!priority) return true
  const salary = priority.indexOf('owner_salary')
  const goals = priority.indexOf('goals')
  if (salary === -1 || goals === -1) return true
  return salary < goals
}

/** The Slack DM body (plan §9 phase 5). '' when there is nothing worth sending. */
export function formatAllocationSummary(plan: AllocationPlan, opts: { dryRun?: boolean } = {}): string {
  if (plan.deltas.length === 0 && plan.skipped.every(s => s.reason === 'complete')) return ''

  const head = opts.dryRun
    ? `🧮 *Maandelijkse toewijzing (proef)* — €${eur(plan.availableCents)} beschikbaar boven de veiligheidsmarge`
    : `💶 *Maandelijkse toewijzing* — €${eur(plan.allocatedCents)} toegewezen van €${eur(plan.availableCents)} beschikbaar`
  const lines = plan.deltas.map(d => `• ${d.label}: +€${eur(d.deltaCents)} → €${eur(d.toCents)}`)
  const held = plan.skipped.filter(s => s.reason !== 'complete')
  const heldLines = held.map(s => `• ${s.label}: niets toegewezen (${SKIP_LABELS[s.reason]})`)

  return [
    head,
    ...(lines.length ? lines : ['• niets toegewezen']),
    ...(heldLines.length ? ['', '_Overgeslagen:_', ...heldLines] : []),
    '',
    `_Rest boven de veiligheidsmarge: €${eur(plan.remainingCents)}._`,
  ].join('\n')
}

function eur(cents: number): string {
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(Math.round(cents / 100))
}
