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
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* Dark overlay — page visible behind */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Modal content */}
      <div
        className="relative z-10 w-full max-w-5xl mx-4 my-8 max-h-[calc(100vh-4rem)] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-[var(--color-primary)] truncate pr-4 font-avenir">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-[var(--color-muted)] hover:text-[var(--color-ink)] flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body: photos + reviews side by side */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Photos grid */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="columns-2 sm:columns-3 gap-3">
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
            <div className="hidden lg:flex lg:flex-col w-80 border-l border-gray-100 overflow-y-auto flex-shrink-0">
              {/* Rating header */}
              <div className="p-5 border-b border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex items-center justify-center w-9 h-9 bg-[var(--color-primary)] text-white rounded-lg font-bold text-sm">
                    {avgRating.toFixed(1)}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-[var(--color-primary)]">
                      {avgRating >= 4.5 ? 'Excellent' : avgRating >= 4 ? 'Very good' : 'Good'}
                    </p>
                    <p className="text-xs text-[var(--color-muted)]">
                      {totalReviews} review{totalReviews !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Review list */}
              <div className="p-5 space-y-4">
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
                          width={32}
                          height={32}
                          className="w-8 h-8 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-xs font-bold">
                          {review.reviewer_name.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--color-ink)] truncate">
                          {review.reviewer_name}
                        </p>
                      </div>
                      <StarRating rating={review.rating} className="flex-shrink-0" />
                    </div>
                    <p className="text-sm text-[var(--color-ink)] leading-relaxed">
                      &ldquo;{review.review_text}&rdquo;
                    </p>
                    {review.source && (
                      <p className="text-xs text-[var(--color-muted)] mt-1.5 capitalize">
                        {review.source}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
