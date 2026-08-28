import type { Review } from './types'
import { inMonth, computeMonthlyStats } from './monthly-stats'

export interface ReviewsOverview {
  /** Reviews whose publish date (falling back to when we ingested it) falls in the current calendar month. */
  newThisMonth: Review[]
  /** A human still needs to pick between candidates — the actionable backlog, not month-scoped. */
  unassignedCount: number
  /** 5-star reviews the AI matcher hasn't checked for staff mentions yet — worth running a scan. */
  unscannedCount: number
  /** Sum of bonus amounts actually AWARDED this month, regardless of which month the review itself is from. */
  bonusCentsThisMonth: number
}

/**
 * Powers the Reviews tab's overview card (Beer, 2026-08-22: "an overview of
 * new reviews that came in, a list of all the reviews this month and total
 * spent, total unassigned"). Pure calculation over the reviews list already
 * fetched by useReviews — no separate summary endpoint needed.
 *
 * bonusCentsThisMonth reuses computeMonthlyStats's per-captain totals for
 * the current month rather than re-summing the same assignees separately —
 * same number either way, one place computing it.
 */
export function computeReviewsOverview(reviews: Review[], now: Date = new Date()): ReviewsOverview {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()

  const newThisMonth: Review[] = []
  let unassignedCount = 0
  let unscannedCount = 0
  for (const r of reviews) {
    if (inMonth(r.publish_time ?? r.created_at, year, month)) newThisMonth.push(r)
    if (r.matchStatus.status === 'needs_confirmation') unassignedCount++
    if (r.rating === 5 && !r.bonus_checked_at) unscannedCount++
  }

  const bonusCentsThisMonth = computeMonthlyStats(reviews, year, month).perCaptain.reduce((sum, c) => sum + c.amountCents, 0)

  return { newThisMonth, unassignedCount, unscannedCount, bonusCentsThisMonth }
}
