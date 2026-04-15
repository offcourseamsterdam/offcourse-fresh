'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { ChevronRight } from 'lucide-react'
import type { GalleryReview } from './ImageGallery'

interface ReviewPopupProps {
  reviews: GalleryReview[]
  totalReviews: number
  visible: boolean
  onHoverChange: (hovering: boolean) => void
}

function getRatingLabel(avg: number): string {
  if (avg >= 4.5) return 'Excellent'
  if (avg >= 4) return 'Very good'
  if (avg >= 3.5) return 'Good'
  return 'Nice'
}

export function ReviewPopup({ reviews, totalReviews, visible, onHoverChange }: ReviewPopupProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isHovering, setIsHovering] = useState(false)

  const nextReview = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % reviews.length)
  }, [reviews.length])

  useEffect(() => {
    if (reviews.length <= 1 || isHovering) return
    const interval = setInterval(nextReview, 5000)
    return () => clearInterval(interval)
  }, [reviews.length, isHovering, nextReview])

  if (reviews.length === 0) return null

  const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length

  return (
    <div
      className={`absolute bottom-4 left-4 z-10 w-64 bg-white rounded-xl shadow-xl p-4 transition-opacity duration-300 hidden sm:block ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onMouseEnter={() => { setIsHovering(true); onHoverChange(true) }}
      onMouseLeave={() => { setIsHovering(false); onHoverChange(false) }}
    >
      {/* Rating badge */}
      <div className="flex items-center gap-2 mb-2">
        <span className="flex items-center justify-center w-9 h-9 bg-[var(--color-primary)] text-white rounded-lg font-bold text-sm">
          {avgRating.toFixed(1)}
        </span>
        <div>
          <p className="text-sm font-bold text-[var(--color-primary)]">{getRatingLabel(avgRating)}</p>
          <p className="text-xs text-[var(--color-muted)]">
            {totalReviews} review{totalReviews !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Current review */}
      <div className="border-t border-gray-100 pt-2 mt-1 h-[120px] overflow-hidden">
        <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1.5 font-semibold">
          What guests loved most
        </p>
        <div key={activeIndex} className="animate-slide-in-right">
          <div className="flex items-center gap-2 mb-1">
            {reviews[activeIndex]?.author_photo_url ? (
              <Image
                src={reviews[activeIndex].author_photo_url!}
                alt=""
                width={20}
                height={20}
                className="w-5 h-5 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-[10px] font-bold">
                {reviews[activeIndex]?.reviewer_name?.charAt(0)}
              </div>
            )}
            <span className="text-xs font-semibold text-[var(--color-ink)]">
              {reviews[activeIndex]?.reviewer_name}
            </span>
          </div>
          <p className="text-xs text-[var(--color-ink)] leading-relaxed line-clamp-3">
            &ldquo;{reviews[activeIndex]?.review_text}&rdquo;
          </p>
        </div>
      </div>

      {/* Dots + next */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          {reviews.map((_, i) => (
            <button
              type="button"
              key={i}
              onClick={() => setActiveIndex(i)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === activeIndex ? 'bg-[var(--color-primary)]' : 'bg-gray-200'
              }`}
              aria-label={`Show review ${i + 1}`}
            />
          ))}
        </div>
        {reviews.length > 1 && (
          <button
            type="button"
            onClick={nextReview}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-[var(--color-muted)] hover:text-[var(--color-primary)]"
            aria-label="Next review"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
