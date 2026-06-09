'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { X, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import type { GalleryImage, GalleryReview } from './ImageGallery'

interface GalleryModalProps {
  images: GalleryImage[]
  videoUrl?: string | null
  title: string
  reviews: GalleryReview[]
  reviewCount?: number
  /** Combined (Google + TripAdvisor) average — falls back to the review rows' average. */
  avgRating?: number | null
  onClose: () => void
}

export function GalleryModal({
  images,
  videoUrl,
  title,
  reviews,
  reviewCount,
  avgRating: avgRatingProp,
  onClose,
}: GalleryModalProps) {
  // null = gallery grid; a number = single-image lightbox showing images[selected]
  const [selected, setSelected] = useState<number | null>(null)

  const totalReviews = reviewCount ?? reviews.length
  const avgRating =
    avgRatingProp != null
      ? avgRatingProp
      : reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0

  const step = (dir: 1 | -1) =>
    setSelected((s) => (s === null ? s : (s + dir + images.length) % images.length))

  // Lock body scroll; Escape backs out of the lightbox first, then closes;
  // arrow keys page through photos while the lightbox is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelected((s) => {
          if (s !== null) return null
          onClose()
          return s
        })
      } else if (e.key === 'ArrowLeft') {
        setSelected((s) => (s === null ? s : (s - 1 + images.length) % images.length))
      } else if (e.key === 'ArrowRight') {
        setSelected((s) => (s === null ? s : (s + 1) % images.length))
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, images.length])

  const inLightbox = selected !== null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pb-4 pt-20 sm:px-9 sm:pb-9"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* Dark overlay — page visible behind */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Modal content — starts below the site header, near-full-screen with
          ~36px breathing room on the sides. */}
      <div
        className="relative z-10 w-full h-[calc(100vh-7rem)] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 bg-[var(--color-primary)] flex-shrink-0">
          {inLightbox && (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="flex items-center gap-1.5 text-white/90 hover:text-white text-sm font-avenir font-semibold border border-white/30 rounded-lg px-3 py-1.5 hover:bg-white/10 transition-colors flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4" /> Back to gallery
            </button>
          )}
          <h2 className={`text-lg font-bold text-white truncate font-avenir flex-1 ${inLightbox ? 'text-center' : ''}`}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors text-white/70 hover:text-white flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body: photos (grid or lightbox) + reviews side by side */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {inLightbox ? (
            /* ── Single-image lightbox ─────────────────────────────────── */
            <div className="flex-1 min-w-0 flex flex-col bg-texture-gallery min-h-0">
              {/* Big image with prev / next. The image sits in an inset, fully
                  positioned box so its `fill` has a definite size to fill. */}
              <div className="relative flex-1 min-h-0">
                {images.length > 1 && (
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous photo"
                    className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white shadow-lg flex items-center justify-center text-[var(--color-primary)] hover:scale-105 transition-transform"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                )}

                <div className="absolute inset-4 sm:inset-6">
                  <Image
                    src={images[selected!].url}
                    alt={images[selected!].alt_text ?? ''}
                    fill
                    className="object-contain"
                    sizes="(max-width: 1024px) 100vw, 70vw"
                    priority
                  />
                </div>

                {images.length > 1 && (
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next photo"
                    className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white shadow-lg flex items-center justify-center text-[var(--color-primary)] hover:scale-105 transition-transform"
                  >
                    <ChevronRight className="w-6 h-6" />
                  </button>
                )}
              </div>

              {/* Counter */}
              <div className="text-center text-white/80 text-sm font-avenir font-semibold py-1 flex-shrink-0">
                {selected! + 1} / {images.length}
              </div>

              {/* Thumbnail strip */}
              <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide flex-shrink-0">
                {images.map((img, i) => (
                  <button
                    key={img.url + i}
                    type="button"
                    onClick={() => setSelected(i)}
                    aria-label={`View photo ${i + 1}`}
                    className={`relative flex-shrink-0 w-20 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                      i === selected ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    <Image src={img.url} alt="" fill className="object-cover" sizes="80px" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Gallery grid ──────────────────────────────────────────── */
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-texture-gallery">
              <div className="columns-2 sm:columns-3 lg:columns-4 gap-3">
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
                  <button
                    key={img.url + i}
                    type="button"
                    onClick={() => setSelected(i)}
                    className="mb-3 break-inside-avoid rounded-xl overflow-hidden block w-full cursor-zoom-in group"
                  >
                    <Image
                      src={img.url}
                      alt={img.alt_text ?? ''}
                      width={600}
                      height={400}
                      className="w-full h-auto object-cover transition-transform duration-300 group-hover:scale-105"
                      sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reviews sidebar — desktop only */}
          {reviews.length > 0 && (
            <div className="hidden lg:flex lg:flex-col w-80 border-l border-gray-100 overflow-y-auto flex-shrink-0 bg-white">
              {/* Rating header */}
              <div className="p-5 border-b border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex items-center justify-center w-9 h-9 bg-[var(--color-primary)] text-white rounded-lg font-bold text-sm">
                    {avgRating.toFixed(1)}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-[var(--color-primary)]">
                      {avgRating >= 4.9 ? 'Exceptional' : avgRating >= 4.5 ? 'Excellent' : avgRating >= 4 ? 'Very good' : 'Good'}
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
