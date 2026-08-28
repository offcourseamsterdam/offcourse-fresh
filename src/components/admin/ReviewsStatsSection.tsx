'use client'

import { useState, useMemo } from 'react'
import { MonthSwitcher } from './MonthSwitcher'
import { ReviewsGrowthChart } from './ReviewsGrowthChart'
import { computeMonthlyStats, computeMonthlyGrowth } from '@/app/[locale]/admin/reviews/monthly-stats'
import type { Review } from '@/app/[locale]/admin/reviews/types'
import { PLATFORM_LABEL } from '@/lib/reviews/platform-labels'

/**
 * Reviews tab statistics (Beer, 2026-08-23: "a monthly stat per captain
 * like with a month switcher, per platform, a growth table or graph").
 * Everything here is derived client-side from the reviews list useReviews
 * already fetched — no separate stats endpoint.
 */
export function ReviewsStatsSection({ reviews }: { reviews: Review[] }) {
  const now = new Date()
  const [year, setYear] = useState(now.getUTCFullYear())
  const [month, setMonth] = useState(now.getUTCMonth())

  const stats = useMemo(() => computeMonthlyStats(reviews, year, month), [reviews, year, month])
  const growth = useMemo(() => computeMonthlyGrowth(reviews, 6), [reviews])

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-zinc-900">Statistics</h2>
        <MonthSwitcher year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-2">Per captain</p>
          {stats.perCaptain.length === 0 ? (
            <p className="text-sm text-zinc-400">No bonuses awarded this month.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {stats.perCaptain.map(c => (
                  <tr key={c.id} className="border-t border-zinc-100 first:border-t-0">
                    <td className="py-1.5 text-zinc-700">{c.name}</td>
                    <td className="py-1.5 text-zinc-400 text-xs text-right whitespace-nowrap">{c.bonusCount} mention{c.bonusCount === 1 ? '' : 's'}</td>
                    <td className="py-1.5 text-zinc-900 font-medium text-right w-16">€{(c.amountCents / 100).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-zinc-500 mb-2">Per platform ({stats.totalReviews} total)</p>
          {stats.perPlatform.length === 0 ? (
            <p className="text-sm text-zinc-400">No reviews landed this month.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {stats.perPlatform.map(p => (
                  <tr key={p.source} className="border-t border-zinc-100 first:border-t-0">
                    <td className="py-1.5 text-zinc-700">{PLATFORM_LABEL[p.source] ?? p.source}</td>
                    <td className="py-1.5 text-zinc-900 font-medium text-right">{p.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-zinc-500 mb-2">Growth — last 6 months</p>
        <ReviewsGrowthChart months={growth} />
      </div>
    </div>
  )
}
