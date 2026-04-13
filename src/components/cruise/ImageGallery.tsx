'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { Camera, ChevronRight } from 'lucide-react'
import { GalleryModal } from './GalleryModal'

export type GalleryImage = { url: string; alt_text?: string | null }
export type GalleryReview = {
  id: string
  reviewer_name: string
  review_text: string
  rating: number
  source: string | null
  author_photo_url: string | null
  publish_time?: string | null
}

interface ImageGalleryProps {
  images: GalleryImage[]
  heroUrl: string | null
  videoUrl?: string | null
  title: string
  reviews: GalleryReview[]
  reviewCount?: number
}

export function ImageGallery({
  images,
  heroUrl,
  videoUrl,
  title,
  reviews,
  reviewCount,
}: ImageGalleryProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isHoveringImages, setIsHoveringImages] = useState(false)
  const [isHoveringReview, setIsHoveringReview] = useState(false)
  const [activeReviewIndex, setActiveReviewIndex] = useState(0)

  // All images: hero first, then the rest (deduplicated)
  const allImages = heroUrl
    ? [
        { url: heroUrl, alt_text: title },
        ...images.filter((img) => img.url !== heroUrl),
      ]
    : images

  // Grid images (everything after the hero)
  const gridImages = allImages.slice(1)

  const hasVideo = !!videoUrl
  const totalReviews = reviewCount ?? reviews.length

  const nextReview = useCallback(() => {
    setActiveReviewIndex((prev) => (prev + 1) % reviews.length)
  }, [reviews.length])

  // Auto-rotate reviews every 5 seconds (pause when hovering the popup)
  useEffect(() => {
    if (reviews.length <= 1 || isHoveringReview) return
    const interval = setInterval(nextReview, 5000)
    return () => clearInterval(interval)
  }, [reviews.length, isHoveringReview, nextReview])

  const avgRating =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0

  const ratingLabel =
    avgRating >= 4.5
      ? 'Excellent'
      : avgRating >= 4
        ? 'Very good'
        : avgRating >= 3.5
          ? 'Good'
          : 'Nice'

  // Review popup is visible unless hovering images (but NOT when hovering the popup itself)
  const showReviewPopup = !isHoveringImages || isHoveringReview

  const openModal = () => setIsModalOpen(true)

  return (
    <>
      <div className="relative">
        {/* ── Desktop gallery grid ── */}
        <div
          className="hidden sm:grid gap-1.5 rounded-2xl overflow-hidden"
          style={{
            gridTemplateColumns: hasVideo ? '2fr 1fr 1fr' : '2fr 1fr 1fr',
            gridTemplateRows: '1fr 1fr 1fr',
            height: '420px',
          }}
          onMouseEnter={() => setIsHoveringImages(true)}
          onMouseLeave={() => setIsHoveringImages(false)}
        >
          {/* Hero — always spans all 3 rows in column 1 */}
          <button
            type="button"
            className="relative row-span-3 cursor-pointer group focus:outline-none"
            onClick={openModal}
            aria-label="View all photos"
          >
            {allImages[0] && (
              <Image
                src={allImages[0].url}
                alt={allImages[0].alt_text ?? title}
                fill
                priority
                className="object-cover group-hover:brightness-90 transition-all duration-200"
                sizes="50vw"
              />
            )}
          </button>

          {hasVideo ? (
            <>
              {/* Video column — spans all 3 rows, portrait / Instagram-style */}
              <div className="relative row-span-3 overflow-hidden">
                <video
                  src={videoUrl!}
                  className="w-full h-full object-cover"
                  muted
                  loop
                  playsInline
                  autoPlay
                />
              </div>

              {/* Three images in the right column */}
              {gridImages.slice(0, 3).map((img, i) => (
                <button
                  type="button"
                  key={img.url}
                  className="relative cursor-pointer group focus:outline-none"
                  onClick={openModal}
                >
                  <Image
                    src={img.url}
                    alt={img.alt_text ?? ''}
                    fill
                    className="object-cover group-hover:brightness-90 transition-all duration-200"
                    sizes="25vw"
                  />
                  {i === 2 && allImages.length > 4 && <ShowAllOverlay count={allImages.length} />}
                </button>
              ))}
            </>
          ) : (
            <>
              {/* Middle column: 2 equal-height images in a flex container spanning 3 rows */}
              <div className="row-span-3 flex flex-col gap-1.5">
                {gridImages.slice(0, 2).map((img) => (
                  <button
                    type="button"
                    key={img.url}
                    className="relative flex-1 cursor-pointer group focus:outline-none"
                    onClick={openModal}
                  >
                    <Image
                      src={img.url}
                      alt={img.alt_text ?? ''}
                      fill
                      className="object-cover group-hover:brightness-90 transition-all duration-200"
                      sizes="25vw"
                    />
                  </button>
                ))}
              </div>
              {/* Right column: 3 images, one per row */}
              {gridImages.slice(2, 5).map((img, i) => (
                <button
                  type="button"
                  key={img.url}
                  className="relative cursor-pointer group focus:outline-none"
                  onClick={openModal}
                >
                  <Image
                    src={img.url}
                    alt={img.alt_text ?? ''}
                    fill
                    className="object-cover group-hover:brightness-90 transition-all duration-200"
                    sizes="25vw"
                  />
                  {i === 2 && allImages.length > 6 && <ShowAllOverlay count={allImages.length} />}
                </button>
              ))}
            </>
          )}
        </div>

        {/* ── Mobile: single hero image ── */}
        <button
          type="button"
          className="sm:hidden relative w-full h-64 rounded-2xl overflow-hidden focus:outline-none"
          onClick={openModal}
        >
          {allImages[0] && (
            <Image
              src={allImages[0].url}
              alt={allImages[0].alt_text ?? title}
              fill
              priority
              className="object-cover"
              sizes="100vw"
            />
          )}
          {allImages.length > 1 && (
            <span className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-sm text-xs font-semibold text-[var(--color-primary)] px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5" />
              {allImages.length} photos
            </span>
          )}
        </button>

        {/* ── Review popup overlay ── */}
        {reviews.length > 0 && (
          <div
            className={`absolute bottom-4 left-4 z-10 w-64 bg-white rounded-xl shadow-xl p-4 transition-opacity duration-300 hidden sm:block ${
              showReviewPopup ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            onMouseEnter={() => setIsHoveringReview(true)}
            onMouseLeave={() => setIsHoveringReview(false)}
          >
            {/* Rating badge */}
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center w-9 h-9 bg-[var(--color-primary)] text-white rounded-lg font-bold text-sm">
                {avgRating.toFixed(1)}
              </span>
              <div>
                <p className="text-sm font-bold text-[var(--color-primary)]">{ratingLabel}</p>
                <p className="text-xs text-[var(--color-muted)]">
                  {totalReviews} review{totalReviews !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Current review — fixed height with slide animation */}
            <div className="border-t border-gray-100 pt-2 mt-1 h-[120px] overflow-hidden">
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1.5 font-semibold">
                What guests loved most
              </p>
              <div
                key={activeReviewIndex}
                className="animate-slide-in-right"
              >
                <div className="flex items-center gap-2 mb-1">
                  {reviews[activeReviewIndex]?.author_photo_url ? (
                    <Image
                      src={reviews[activeReviewIndex].author_photo_url!}
                      alt=""
                      width={20}
                      height={20}
                      className="w-5 h-5 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-[10px] font-bold">
                      {reviews[activeReviewIndex]?.reviewer_name?.charAt(0)}
                    </div>
                  )}
                  <span className="text-xs font-semibold text-[var(--color-ink)]">
                    {reviews[activeReviewIndex]?.reviewer_name}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-ink)] leading-relaxed line-clamp-3">
                  &ldquo;{reviews[activeReviewIndex]?.review_text}&rdquo;
                </p>
              </div>
            </div>

            {/* Dots + next chevron */}
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1.5">
                {reviews.map((_, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => setActiveReviewIndex(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      i === activeReviewIndex ? 'bg-[var(--color-primary)]' : 'bg-gray-200'
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
        )}
      </div>

      {/* ── Fullscreen modal ── */}
      {isModalOpen && (
        <GalleryModal
          images={allImages}
          videoUrl={videoUrl}
          title={title}
          reviews={reviews}
          reviewCount={totalReviews}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  )
}

/* ── "Show all photos" button overlay ── */
function ShowAllOverlay({ count }: { count: number }) {
  return (
    <div className="absolute inset-0 bg-black/30 flex items-end justify-end p-3 pointer-events-none">
      <span className="pointer-events-auto bg-white/90 backdrop-blur-sm text-sm font-semibold text-[var(--color-primary)] px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-white transition-colors">
        <Camera className="w-4 h-4" />
        Show all photos
      </span>
    </div>
  )
}
