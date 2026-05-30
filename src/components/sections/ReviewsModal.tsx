'use client'

import { useEffect, useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import { ReviewPhoto } from '@/components/ui/ReviewPhoto'
import type { SliderReview } from './ReviewsSlider'

type SourceFilter = 'all' | 'google' | 'tripadvisor'
type SortOrder = 'newest' | 'oldest'

function sourceLabel(source: string): string {
  if (source === 'tripadvisor') return 'via TripAdvisor'
  if (source === 'google') return 'via Google'
  return ''
}

function formatDate(publishTime: string | null): string {
  if (!publishTime) return ''
  try {
    return new Date(publishTime).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

/**
 * "See all reviews" modal — filter by source + star rating, sort newest/oldest,
 * scroll through every review. Mirrors GalleryModal (overlay + scroll-lock + Escape).
 */
export function ReviewsModal({ reviews, onClose }: { reviews: SliderReview[]; onClose: () => void }) {
  const [source, setSource] = useState<SourceFilter>('all')
  const [stars, setStars] = useState<number>(0) // 0 = all ratings
  const [sort, setSort] = useState<SortOrder>('newest')

  // Lock body scroll & close on Escape
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const hasGoogle = reviews.some(r => r.source === 'google')
  const hasTa = reviews.some(r => r.source === 'tripadvisor')
  const showSourceFilter = hasGoogle && hasTa

  const filtered = useMemo(() => {
    let list = reviews
    if (source !== 'all') list = list.filter(r => r.source === source)
    if (stars > 0) list = list.filter(r => Math.round(r.rating) === stars)
    return [...list].sort((a, b) => {
      const ta = a.publish_time ? new Date(a.publish_time).getTime() : 0
      const tb = b.publish_time ? new Date(b.publish_time).getTime() : 0
      return sort === 'newest' ? tb - ta : ta - tb
    })
  }, [reviews, source, stars, sort])

  const pill = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-avenir font-medium transition-colors whitespace-nowrap ${
      active
        ? 'bg-[var(--color-primary)] text-white'
        : 'bg-gray-100 text-[var(--color-muted)] hover:text-[var(--color-primary)]'
    }`

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-16 sm:pt-20 pb-6 px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70" />

      <div
        className="relative z-10 w-full max-w-3xl max-h-[calc(100vh-5rem)] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[var(--color-primary)] flex-shrink-0">
          <h2 className="text-lg font-bold text-white font-avenir">
            Reviews <span className="text-white/70 font-normal">({reviews.length})</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors text-white/70 hover:text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter bar */}
        <div className="px-4 sm:px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-x-2 gap-y-2 flex-shrink-0">
          {showSourceFilter && (
            <div className="flex gap-1">
              {(['all', 'google', 'tripadvisor'] as SourceFilter[]).map(s => (
                <button key={s} onClick={() => setSource(s)} className={pill(source === s)}>
                  {s === 'all' ? 'All' : s === 'google' ? 'Google' : 'TripAdvisor'}
                </button>
              ))}
            </div>
          )}

          {showSourceFilter && <span className="h-5 w-px bg-gray-200 hidden sm:block" />}

          {/* Star rating filter */}
          <div className="flex gap-1">
            {[0, 5, 4, 3, 2, 1].map(n => (
              <button key={n} onClick={() => setStars(n)} className={pill(stars === n)}>
                {n === 0 ? 'All' : `${n}★`}
              </button>
            ))}
          </div>

          {/* Sort */}
          <button
            onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}
            className="ml-auto px-3 py-1.5 rounded-full text-xs font-avenir font-medium bg-gray-100 text-[var(--color-primary)] hover:bg-gray-200 transition-colors whitespace-nowrap"
          >
            {sort === 'newest' ? 'Newest first' : 'Oldest first'}
          </button>
        </div>

        {/* Review list */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-[var(--color-muted)] py-12">
              No reviews match these filters.
            </p>
          ) : (
            <div className="space-y-4">
              {filtered.map(review => (
                <div key={review.id} className="border-b border-gray-100 pb-4 last:border-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    {review.author_photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={review.author_photo_url}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {review.reviewer_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-ink)] truncate">
                        {review.reviewer_name}
                      </p>
                      {formatDate(review.publish_time) && (
                        <p className="text-xs text-[var(--color-muted)]">{formatDate(review.publish_time)}</p>
                      )}
                    </div>
                    <StarRating rating={review.rating} className="flex-shrink-0" />
                  </div>

                  <p className="text-sm text-[var(--color-ink)] leading-relaxed">
                    &ldquo;{review.review_text}&rdquo;
                  </p>

                  {review.review_image_url && (
                    <ReviewPhoto
                      src={review.review_image_url}
                      className="mt-2 rounded-lg object-cover max-h-48"
                    />
                  )}

                  {sourceLabel(review.source) && (
                    <p className="text-xs text-[var(--color-muted)] mt-1.5">{sourceLabel(review.source)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
