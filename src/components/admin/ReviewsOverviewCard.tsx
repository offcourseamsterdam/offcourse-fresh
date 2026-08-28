'use client'

import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ReviewsOverview } from '@/app/[locale]/admin/reviews/overview'

interface ReviewsOverviewCardProps {
  overview: ReviewsOverview
  scanning: boolean
  scanResult: string | null
  onScan: () => void
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div>
      <p className={`text-2xl font-semibold ${warn ? 'text-amber-600' : 'text-zinc-900'}`}>{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
    </div>
  )
}

/**
 * The Reviews tab's monthly snapshot (Beer, 2026-08-22: "an overview of new
 * reviews that came in... total spent, total unassigned"). Numbers are
 * derived client-side from the already-fetched reviews list — see
 * computeReviewsOverview — no separate summary endpoint.
 */
export function ReviewsOverviewCard({ overview, scanning, scanResult, onScan }: ReviewsOverviewCardProps) {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="New this month" value={overview.newThisMonth.length} />
        <Stat label="Bonuses paid this month" value={`€${(overview.bonusCentsThisMonth / 100).toFixed(0)}`} />
        <Stat label="Awaiting your input" value={overview.unassignedCount} warn={overview.unassignedCount > 0} />
        <Stat label="Not yet scanned" value={overview.unscannedCount} warn={overview.unscannedCount > 0} />
      </div>
      <div className="flex items-center gap-3 pt-3 border-t border-zinc-100 flex-wrap">
        <Button variant="outline" size="sm" onClick={onScan} disabled={scanning}>
          {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {overview.unscannedCount > 0 ? `Scan ${overview.unscannedCount} for staff mentions` : 'Re-scan for staff mentions'}
        </Button>
        {scanResult && <p className="text-xs text-zinc-500">{scanResult}</p>}
      </div>
    </div>
  )
}
