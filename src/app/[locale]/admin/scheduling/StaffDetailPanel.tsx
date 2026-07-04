'use client'

import { X, Star, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtEuros } from '@/lib/utils'
import type { StaffRow } from './StaffFormModal'

interface ReviewBonus {
  id: string
  amount_cents: number
  awarded_at: string
  review: {
    id: string
    reviewer_name: string
    rating: number
    review_text: string
    source: string
    publish_time: string | null
  } | null
}

interface BonusPayload {
  bonuses: ReviewBonus[]
  total_cents: number
}

const SOURCE_LABEL: Record<string, string> = {
  google: 'Google',
  tripadvisor: 'TripAdvisor',
  manual: 'Manual',
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${i < rating ? 'text-amber-400 fill-amber-400' : 'text-zinc-200'}`}
        />
      ))}
    </span>
  )
}

export function StaffDetailPanel({
  staff,
  onClose,
  onEdit,
}: {
  staff: StaffRow
  onClose: () => void
  onEdit: () => void
}) {
  const { data, isLoading } = useAdminFetch<BonusPayload>(
    `/api/admin/scheduling/staff/${staff.id}/bonuses`,
  )

  const bonuses = data?.bonuses ?? []
  const totalCents = data?.total_cents ?? 0

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">{staff.name}</h2>
            <p className="text-xs text-zinc-400 capitalize">{staff.role}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}>
              Edit
            </Button>
            <button
              onClick={onClose}
              className="p-2 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Review bonus summary */}
        <div className="px-5 py-4 border-b border-zinc-100 bg-amber-50/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Review bonuses
              </p>
              <p className="text-2xl font-bold text-zinc-900 mt-0.5">{fmtEuros(totalCents)}</p>
              <p className="text-xs text-zinc-400 mt-0.5">
                {bonuses.length === 0
                  ? 'No mentions in reviews yet'
                  : `${bonuses.length} mention${bonuses.length !== 1 ? 's' : ''} across all reviews`}
              </p>
            </div>
            <div className="text-3xl">⭐</div>
          </div>
        </div>

        {/* Bonus list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-zinc-400 px-5 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {!isLoading && bonuses.length === 0 && (
            <div className="px-5 py-12 text-center text-zinc-400 text-sm">
              <p className="text-3xl mb-2">📝</p>
              <p>
                When a review mentions <strong className="text-zinc-600">{staff.name.split(' ')[0]}</strong>,
                a €5 bonus appears here automatically.
              </p>
            </div>
          )}

          {bonuses.map(bonus => (
            <div
              key={bonus.id}
              className="px-5 py-4 border-b border-zinc-50 last:border-0 hover:bg-zinc-50/50"
            >
              {bonus.review ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Stars rating={bonus.review.rating} />
                        <span className="text-[10px] text-zinc-400 uppercase tracking-wide">
                          {SOURCE_LABEL[bonus.review.source] ?? bonus.review.source}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-zinc-700 mb-0.5">
                        {bonus.review.reviewer_name}
                      </p>
                      <p className="text-xs text-zinc-500 line-clamp-3 leading-relaxed">
                        {bonus.review.review_text}
                      </p>
                      <p className="text-[10px] text-zinc-300 mt-1.5">
                        {bonus.review.publish_time
                          ? new Date(bonus.review.publish_time).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : new Date(bonus.awarded_at).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                      +{fmtEuros(bonus.amount_cents)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Review deleted</span>
                  <span className="text-xs font-semibold text-amber-700">+{fmtEuros(bonus.amount_cents)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
