'use client'

import { Star } from 'lucide-react'
import { computeReviewToBookingRatio } from '@/lib/reviews/ratio'
import type { Review } from '@/app/[locale]/admin/reviews/types'

interface Props {
  reviews: Review[]
  bookingsCount: number
}

function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

export function ReviewBookingRatioCard({ reviews, bookingsCount }: Props) {
  const result = computeReviewToBookingRatio(reviews, bookingsCount)
  const maxCount = Math.max(1, ...result.byStars.map(b => b.count))

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">Review-to-booking ratio</h2>
        <p className="text-xs text-zinc-400">
          {result.totalReviews} reviews · {result.bookingsCount} bookings ·{' '}
          <span className="font-medium text-zinc-600">{fmtPct(result.overallRatio)} overall</span>
        </p>
      </div>

      <div className="px-6 py-4 space-y-2">
        {result.byStars.map(bucket => (
          <div key={bucket.stars} className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-0.5 w-16 shrink-0">
              {bucket.stars}
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
            </div>
            <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full"
                style={{ width: `${(bucket.count / maxCount) * 100}%` }}
              />
            </div>
            <div className="w-28 shrink-0 text-right text-zinc-500">
              {bucket.count} · {fmtPct(bucket.ratio)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
