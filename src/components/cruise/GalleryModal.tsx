'use client'

import { useEffect } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import type { GalleryImage, GalleryReview } from './ImageGallery'

interface GalleryModalProps {
  images: GalleryImage[]
  videoUrl?: string | null
  title: string
  reviews: GalleryReview[]
  reviewCount?: number
  onClose: () => void
}

export function GalleryModal({
  images,
  videoUrl,
  title,
  reviews,
  reviewCount,
  onClose,
}: GalleryModalProps) {
  const totalReviews = reviewCount ?? reviews.length
  const avgRating =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0

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

  return (
    <div className="fixed inset-0 z-50 bg-white" role="dialog" aria-modal="true">
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-bold text-[var(--color-primary)] truncate pr-4 font-avenir">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-primary)] transition-colors flex-shrink-0"
        >
          Close
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* ── Body: masonry grid + reviews sidebar ── */}
      <div className="flex h-[calc(100vh-65px)] overflow-hidden">
        {/* Photos grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="columns-2 sm:columns-3 gap-3 max-w-5xl mx-auto">
            {/* Optional video as first item */}
            {videoUrl && (
              <div className="mb-3 break-inside-avoid rounded-xl overflow-hidden">
                <video
                  src={videoUrl}
                  className="w-full h-auto object-cover"
                  controls
                  playsInline
                  muted
                />
              </div>
            )}

            {images.map((img, i) => (
              <div
                key={img.url + i}
                className="mb-3 break-inside-avoid rounded-xl overflow-hidden"
              >
                <Image
                  src={img.url}
                  alt={img.alt_text ?? ''}
                  width={600}
                  height={400}
                  className="w-full h-auto object-cover"
                  sizes="(min-width: 640px) 33vw, 50vw"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Reviews sidebar — desktop only */}
        {reviews.length > 0 && (
          <div className="hidden lg:flex lg:flex-col w-80 border-l border-gray-200 overflow-y-auto">
            {/* Rating header */}
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                <StarRating rating={Math.round(avgRating)} />
                <span className="text-sm font-bold text-[var(--color-primary)]">
                  {avgRating.toFixed(1)}
                </span>
              </div>
              <p className="text-xs text-[var(--color-muted)]">
                {totalReviews} review{totalReviews !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Review list */}
            <div className="p-6">
              <h3 className="text-sm font-bold text-[var(--color-primary)] mb-4 font-avenir">
                What guests loved most:
              </h3>
              <div className="space-y-5">
                {reviews.map((review) => (
                  <div
                    key={review.id}
                    className="border-b border-gray-100 pb-4 last:border-0"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      {review.author_photo_url ? (
                        <Image
                          src={review.author_photo_url}
                          alt=""
                          width={24}
                          height={24}
                          className="w-6 h-6 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-xs font-bold">
                          {review.reviewer_name.charAt(0)}
                        </div>
                      )}
                      <span className="text-sm font-semibold text-[var(--color-ink)]">
                        {review.reviewer_name}
                      </span>
                    </div>
                    <StarRating rating={review.rating} className="mb-1.5" />
                    <p className="text-sm text-[var(--color-ink)] leading-relaxed">
                      &ldquo;{review.review_text}&rdquo;
                    </p>
                    {review.source && (
                      <p className="text-xs text-[var(--color-muted)] mt-1 capitalize">
                        Posted on {review.source}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
