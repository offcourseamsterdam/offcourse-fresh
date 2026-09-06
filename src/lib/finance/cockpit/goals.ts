/**
 * Goal progress. Pure.
 *
 * `funded_cents` is a stored planning reserve (see the plan §2.1). This module
 * only derives: progress, remaining, "behind schedule" and months left.
 *
 * "Behind schedule" compares the reserve with what a steady plan would have
 * put aside by today:
 * - with a monthly funding amount: months since creation × monthly, capped at target
 * - else with a deadline: linear from creation to deadline
 * - else: no plan → never behind
 */

import { daysBetween, type ISODate } from './dates'
import type { GoalProgress, GoalRow } from './types'

const AVG_MONTH_DAYS = 30.4375

export function goalProgress(goal: GoalRow, today: ISODate): GoalProgress {
  const goalType = goal.goalType ?? 'target'
  const funded = Math.min(goal.fundedCents, goal.targetCents)
  const remaining = Math.max(0, goal.targetCents - funded)
  const progressPct = goal.targetCents > 0 ? Math.round((funded / goal.targetCents) * 100) : 0

  const monthsElapsed = Math.max(0, daysBetween(goal.createdAt, today) / AVG_MONTH_DAYS)
  const monthsLeft = goal.deadline ? Math.max(0, Math.round(daysBetween(today, goal.deadline) / AVG_MONTH_DAYS)) : null

  let plannedByNow = 0
  if (goal.status === 'active') {
    if (goalType === 'monthly_refill') {
      // A monthly refill fund aims to be full (at target) every month
      plannedByNow = goal.targetCents
    } else if (goal.monthlyFundingCents > 0) {
      plannedByNow = Math.min(goal.targetCents, Math.round(Math.floor(monthsElapsed) * goal.monthlyFundingCents))
    } else if (goal.deadline) {
      const totalDays = daysBetween(goal.createdAt, goal.deadline)
      const elapsedDays = daysBetween(goal.createdAt, today)
      plannedByNow = totalDays > 0
        ? Math.min(goal.targetCents, Math.round((Math.max(0, elapsedDays) / totalDays) * goal.targetCents))
        : goal.targetCents
    }
  }
  const behindCents = Math.max(0, plannedByNow - funded)

  return {
    id: goal.id,
    name: goal.name,
    goalType,
    targetCents: goal.targetCents,
    fundedCents: funded,
    remainingCents: remaining,
    progressPct,
    plannedByNowCents: plannedByNow,
    behindCents,
    monthsLeft,
    onTrack: behindCents === 0,
  }
}

export function sumGoalFunding(goals: GoalProgress[]): number {
  return goals.reduce((s, g) => s + g.fundedCents, 0)
}
