'use client'

import { useRef, useState, useEffect } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'

export type SliderReview = {
  id: string
  reviewer_name: string
  review_text: string
  rating: number
  source: string | null
  author_photo_url: string | null
  publish_time: string | null
}

interface ReviewSliderProps {
  reviews: SliderReview[]
}

export function ReviewSlider({ reviews }: ReviewSliderProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [modalReview, setModalReview] = useState<SliderReview | null>(null)

  if (reviews.length === 0) return null

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return
    const amount = 340
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    })
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-briston text-[28px] sm:text-[36px] text-[var(--color-accent)] uppercase">
          What people say
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => scroll('left')}
            className="w-9 h-9 flex items-center justify-center rounded-full border border-gray-200 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors text-[var(--color-muted)]"
            aria-label="Previous reviews"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scroll('right')}
            className="w-9 h-9 flex items-center justify-center rounded-full border border-gray-200 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors text-[var(--color-muted)]"
            aria-label="Next reviews"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Horizontal scroll container */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 -mx-1 px-1 snap-x snap-mandatory"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {reviews.map((review) => (
          <button
            type="button"
            key={review.id}
            className="flex-shrink-0 w-[320px] bg-white rounded-xl p-5 shadow-sm snap-start text-left cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setModalReview(review)}
          >
            {/* Header: photo + name + stars */}
            <div className="flex items-center gap-3 mb-3">
              {review.author_photo_url ? (
                <Image
                  src={review.author_photo_url}
                  alt={review.reviewer_name}
                  width={44}
                  height={44}
                  className="w-11 h-11 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-11 h-11 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-base font-bold flex-shrink-0">
                  {review.reviewer_name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--color-primary)] truncate">
                  {review.reviewer_name}
                </p>
                {review.publish_time && (
                  <p className="text-[11px] text-[var(--color-muted)]">
                    {formatReviewDate(review.publish_time)}
                  </p>
                )}
              </div>
              <StarRating rating={review.rating} className="flex-shrink-0" />
            </div>

            {/* Review text — truncated to 3 lines */}
            <p className="text-sm text-[var(--color-ink)] leading-relaxed line-clamp-3">
              &ldquo;{review.review_text}&rdquo;
            </p>

            {/* Source + read more */}
            <div className="flex items-center justify-between mt-2">
              {review.source && (
                <span className="text-xs text-[var(--color-muted)] capitalize">
                  {review.source}
                </span>
              )}
              <span className="text-xs text-[var(--color-primary)] font-semibold ml-auto">
                Read more
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Review detail modal */}
      {modalReview && (
        <ReviewModal review={modalReview} onClose={() => setModalReview(null)} />
      )}
    </section>
  )
}

function ReviewModal({
  review,
  onClose,
}: {
  review: SliderReview
  onClose: () => void
}) {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal content */}
      <div
        className="relative z-10 bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-4 mb-4 pr-8">
          {review.author_photo_url ? (
            <Image
              src={review.author_photo_url}
              alt={review.reviewer_name}
              width={56}
              height={56}
              className="w-14 h-14 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-xl font-bold flex-shrink-0">
              {review.reviewer_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-[var(--color-primary)]">
              {review.reviewer_name}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <StarRating rating={review.rating} />
              {review.publish_time && (
                <span className="text-xs text-[var(--color-muted)]">
                  {formatReviewDate(review.publish_time)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Full review text */}
        <p className="text-sm text-[var(--color-ink)] leading-relaxed">
          &ldquo;{review.review_text}&rdquo;
        </p>

        {/* Source */}
        {review.source && (
          <p className="text-xs text-[var(--color-muted)] mt-4 capitalize">
            Posted on {review.source}
          </p>
        )}
      </div>
    </div>
  )
}

function formatReviewDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}
