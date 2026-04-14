'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'

// ── Types ────────────────────────────────────────────────────────────────────

export interface SliderReview {
  id: string
  reviewer_name: string
  review_text: string
  rating: number
  source: string
  author_photo_url: string | null
  publish_time: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <svg
          key={i}
          className={`w-4 h-4 ${i <= rating ? 'text-yellow-400' : 'text-gray-200'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

function AuthorPhoto({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return (
      <Image
        src={url}
        alt={name}
        width={36}
        height={36}
        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
        referrerPolicy="no-referrer"
      />
    )
  }
  return (
    <div className="w-9 h-9 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-sm font-semibold flex-shrink-0">
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

function formatDate(publishTime: string | null): string {
  if (!publishTime) return ''
  try {
    return new Date(publishTime).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

// ── Modal ────────────────────────────────────────────────────────────────────

function ReviewModal({ review, onClose }: { review: SliderReview; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal card */}
      <div
        className="relative bg-white rounded-3xl shadow-2xl max-w-lg w-full p-8 max-h-[85vh] overflow-y-auto animate-modal-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          aria-label="Close"
        >
          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Stars */}
        <Stars rating={review.rating} />

        {/* Full review text */}
        <blockquote className="mt-4 text-[var(--color-foreground)] leading-relaxed text-base">
          &ldquo;{review.review_text}&rdquo;
        </blockquote>

        {/* Author footer */}
        <footer className="mt-6 flex items-center gap-3 pt-5 border-t border-gray-100">
          <AuthorPhoto url={review.author_photo_url} name={review.reviewer_name} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[var(--color-primary)] text-sm">{review.reviewer_name}</p>
            {formatDate(review.publish_time) && (
              <p className="text-xs text-[var(--color-muted)]">{formatDate(review.publish_time)}</p>
            )}
          </div>
          {review.source && (
            <span className="text-xs text-[var(--color-muted)] capitalize">{review.source}</span>
          )}
        </footer>
      </div>
    </div>,
    document.body
  )
}

// ── Slider card ──────────────────────────────────────────────────────────────

const TRUNCATE_AT = 160 // chars

function SliderCard({ review, onClick }: { review: SliderReview; onClick: () => void }) {
  const isTruncated = review.review_text.length > TRUNCATE_AT
  const displayText = isTruncated
    ? review.review_text.slice(0, TRUNCATE_AT).trimEnd() + '…'
    : review.review_text

  return (
    <article
      className="scroll-snap-align-start flex-shrink-0 w-[min(80vw,320px)] sm:w-[300px] bg-white border border-gray-100 rounded-2xl shadow-md p-6 flex flex-col gap-3 cursor-pointer hover:shadow-lg transition-shadow"
      onClick={onClick}
    >
      <Stars rating={review.rating} />

      <blockquote className="text-sm leading-relaxed text-[var(--color-foreground)] flex-1">
        &ldquo;{displayText}&rdquo;
      </blockquote>

      {isTruncated && (
        <span className="text-xs font-semibold text-[var(--color-primary)] hover:underline">
          Read more →
        </span>
      )}

      <footer className="flex items-center gap-2 pt-3 border-t border-gray-100">
        <AuthorPhoto url={review.author_photo_url} name={review.reviewer_name} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[var(--color-primary)] text-xs truncate">{review.reviewer_name}</p>
          {formatDate(review.publish_time) && (
            <p className="text-[10px] text-[var(--color-muted)]">{formatDate(review.publish_time)}</p>
          )}
        </div>
        {review.source && (
          <span className="text-[10px] text-[var(--color-muted)] capitalize flex-shrink-0">{review.source}</span>
        )}
      </footer>
    </article>
  )
}

// ── Main slider ──────────────────────────────────────────────────────────────

export function ReviewsSlider({ reviews }: { reviews: SliderReview[] }) {
  const [activeModal, setActiveModal] = useState<SliderReview | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollBy = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir === 'right' ? 340 : -340, behavior: 'smooth' })
  }, [])

  return (
    <div className="relative">
      {/* Left arrow */}
      <button
        onClick={() => scrollBy('left')}
        className="hidden sm:flex absolute -left-5 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white border border-gray-200 shadow-md items-center justify-center hover:bg-gray-50 transition-colors"
        aria-label="Scroll left"
      >
        <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Scrollable track */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide"
        style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
      >
        {/* Left fade spacer */}
        <div className="flex-shrink-0 w-1 sm:w-5" />

        {reviews.map(review => (
          <SliderCard
            key={review.id}
            review={review}
            onClick={() => setActiveModal(review)}
          />
        ))}

        {/* Right fade spacer */}
        <div className="flex-shrink-0 w-1 sm:w-5" />
      </div>

      {/* Right arrow */}
      <button
        onClick={() => scrollBy('right')}
        className="hidden sm:flex absolute -right-5 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white border border-gray-200 shadow-md items-center justify-center hover:bg-gray-50 transition-colors"
        aria-label="Scroll right"
      >
        <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Modal */}
      {activeModal && (
        <ReviewModal review={activeModal} onClose={() => setActiveModal(null)} />
      )}
    </div>
  )
}
