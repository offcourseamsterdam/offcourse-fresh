'use client'

import { useState } from 'react'
import { Star, Users } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'

interface Candidate {
  id: string
  name: string
  role: string
}

interface ConflictReview {
  id: string
  reviewer_name: string
  rating: number
  review_text: string
  source: string
  publish_time: string | null
}

interface Conflict {
  id: string
  matched_name: string
  created_at: string
  review: ConflictReview | null
  candidates: Candidate[]
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

function ConflictCard({
  conflict,
  onResolved,
}: {
  conflict: Conflict
  onResolved: () => void
}) {
  const [loading, setLoading] = useState<string | null>(null)

  async function resolve(staffId: string | null) {
    setLoading(staffId ?? 'skip')
    try {
      const res = await fetch(`/api/admin/reviews/conflicts/${conflict.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: staffId }),
        credentials: 'include',
      })
      if (res.ok) onResolved()
    } finally {
      setLoading(null)
    }
  }

  const candidateCount = conflict.candidates.length
  const names = conflict.candidates.map(c => c.name.split(' ')[0]).join(' and ')
  // One candidate = a common-word name ("Will", "Grace") that matched ordinary
  // prose; two+ = genuinely different people sharing a first name.
  const isCommonWord = candidateCount === 1

  return (
    <div className="bg-white border border-amber-200 rounded-2xl p-5 space-y-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
          <Users className="w-4 h-4 text-amber-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-900">
            {isCommonWord
              ? `Is this review about ${conflict.candidates[0].name}?`
              : `${candidateCount} people named ${conflict.matched_name} — who gets the €5?`}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {isCommonWord ? (
              <>
                <strong>{conflict.matched_name}</strong> is also a common word, so we
                couldn&apos;t be sure the review means the person. Award the €5 or skip.
              </>
            ) : (
              <>
                This review mentions <strong>{conflict.matched_name}</strong>, but {names} are
                both active staff. Pick one or skip.
              </>
            )}
          </p>
        </div>
      </div>

      {/* Review snippet */}
      {conflict.review && (
        <div className="bg-zinc-50 rounded-xl px-4 py-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <Stars rating={conflict.review.rating} />
            <span className="text-[10px] text-zinc-400 uppercase tracking-wide">
              {SOURCE_LABEL[conflict.review.source] ?? conflict.review.source}
            </span>
            <span className="text-[10px] text-zinc-400">— {conflict.review.reviewer_name}</span>
          </div>
          <p className="text-xs text-zinc-600 leading-relaxed line-clamp-4">
            {conflict.review.review_text}
          </p>
        </div>
      )}

      {/* Candidate buttons + Skip */}
      <div className="flex flex-wrap gap-2">
        {conflict.candidates.map(c => (
          <button
            key={c.id}
            onClick={() => resolve(c.id)}
            disabled={loading !== null}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading === c.id ? '…' : `${c.name} gets €5`}
          </button>
        ))}
        <button
          onClick={() => resolve(null)}
          disabled={loading !== null}
          className="px-4 py-2 text-sm font-medium rounded-xl border border-zinc-200 text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
        >
          {loading === 'skip' ? '…' : 'Skip — no bonus'}
        </button>
      </div>
    </div>
  )
}

export function BonusConflictCards() {
  const { data, isLoading, refresh } = useAdminFetch<{ conflicts: Conflict[] }>(
    '/api/admin/reviews/conflicts',
  )
  const conflicts = data?.conflicts ?? []

  if (isLoading || conflicts.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
          <Users className="w-3 h-3" />
          {conflicts.length} bonus {conflicts.length === 1 ? 'conflict' : 'conflicts'} need your input
        </span>
      </div>
      {conflicts.map(c => (
        <ConflictCard key={c.id} conflict={c} onResolved={refresh} />
      ))}
    </section>
  )
}
