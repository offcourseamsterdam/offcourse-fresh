import type { Review } from './types'

export interface CaptainMonthStat {
  id: string
  name: string
  bonusCount: number
  amountCents: number
}

export interface PlatformMonthStat {
  source: string
  count: number
}

export interface MonthlyStats {
  perCaptain: CaptainMonthStat[]
  perPlatform: PlatformMonthStat[]
  totalReviews: number
}

/** Shared by every month-bucketed stat in this file (and overview.ts) — one place that defines "is this timestamp in month X of year Y". */
export function inMonth(iso: string | null, year: number, month: number): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return d.getUTCFullYear() === year && d.getUTCMonth() === month
}

/**
 * The Reviews tab's month-switcher statistics (Beer, 2026-08-23: "a monthly
 * stat per captain... per platform"). `month` is 0-indexed (JS Date
 * convention) so callers can pass `date.getUTCMonth()` directly.
 *
 * Bonuses are bucketed by when they were AWARDED (when the mention was
 * found), same convention as computeReviewsOverview and payroll-query.ts —
 * a review from March mentioned and matched in August counts toward
 * August's captain stats, not March's. Platform counts are bucketed by
 * publish date instead, since that's about when the review itself landed.
 * One pass over `reviews` computes both, since they're independent
 * aggregations over the same rows.
 */
export function computeMonthlyStats(reviews: Review[], year: number, month: number): MonthlyStats {
  const captainMap = new Map<string, CaptainMonthStat>()
  const platformMap = new Map<string, number>()
  let totalReviews = 0

  for (const r of reviews) {
    if (r.matchStatus.status === 'assigned') {
      for (const a of r.matchStatus.assignees) {
        if (!inMonth(a.awardedAt, year, month)) continue
        const existing = captainMap.get(a.id) ?? { id: a.id, name: a.name, bonusCount: 0, amountCents: 0 }
        existing.bonusCount += 1
        existing.amountCents += a.amountCents
        captainMap.set(a.id, existing)
      }
    }

    if (inMonth(r.publish_time ?? r.created_at, year, month)) {
      platformMap.set(r.source, (platformMap.get(r.source) ?? 0) + 1)
      totalReviews++
    }
  }

  const perCaptain = [...captainMap.values()].sort((a, b) => b.amountCents - a.amountCents)
  const perPlatform = [...platformMap.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count)

  return { perCaptain, perPlatform, totalReviews }
}

export interface GrowthMonth {
  year: number
  month: number
  label: string
  bySource: Record<string, number>
  total: number
}

function monthKey(year: number, month: number): string {
  return `${year}-${month}`
}

/**
 * Review-volume trend for the growth chart — one entry per month, oldest
 * first, going back `monthsBack` months from `now` (inclusive of the
 * current month). Buckets by publish date (falling back to when we
 * ingested it), NOT by award date — this chart is about how many reviews
 * are coming IN, not the bonus/payroll side.
 *
 * One pass over `reviews` (not one pass per month) — buckets every review
 * into a year-month map up front, then reads out just the `monthsBack` keys
 * needed, so cost is O(reviews + monthsBack) instead of O(reviews × monthsBack).
 */
export function computeMonthlyGrowth(reviews: Review[], monthsBack: number, now: Date = new Date()): GrowthMonth[] {
  const months: GrowthMonth[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth(), label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }), bySource: {}, total: 0 })
  }

  const monthByKey = new Map(months.map(m => [monthKey(m.year, m.month), m]))
  for (const r of reviews) {
    const iso = r.publish_time ?? r.created_at
    if (!iso) continue
    const d = new Date(iso)
    const bucket = monthByKey.get(monthKey(d.getUTCFullYear(), d.getUTCMonth()))
    if (!bucket) continue // outside the monthsBack window
    bucket.bySource[r.source] = (bucket.bySource[r.source] ?? 0) + 1
    bucket.total++
  }

  return months
}
