'use client'

import { useState } from 'react'
import { GalleryModal } from './GalleryModal'
import { DesktopGalleryGrid } from './DesktopGalleryGrid'
import { MobileCarousel } from './MobileCarousel'
import { ReviewPopup } from './ReviewPopup'

import type { ImageAsset } from '@/lib/images/types'

export type GalleryImage = { url: string; alt_text?: string | null; asset?: ImageAsset | null }
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
  heroAsset?: ImageAsset | null
  videoUrl?: string | null
  title: string
  reviews: GalleryReview[]
  reviewCount?: number
  /** Combined (Google + TripAdvisor) average rating — keeps the popup/modal badge in sync with the page header. */
  avgRating?: number | null
}

export function ImageGallery({
  images,
  heroUrl,
  heroAsset,
  videoUrl,
  title,
  reviews,
  reviewCount,
  avgRating,
}: ImageGalleryProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isHoveringImages, setIsHoveringImages] = useState(false)
  const [isHoveringReview, setIsHoveringReview] = useState(false)

  // All images: hero first (with its optimized asset), then the rest (deduplicated)
  const allImages = heroUrl
    ? [{ url: heroUrl, alt_text: title, asset: heroAsset ?? null }, ...images.filter((img) => img.url !== heroUrl)]
    : images

  const gridImages = allImages.slice(1)
  const totalReviews = reviewCount ?? reviews.length
  // The floating popup is a teaser that rotates through a handful of reviews
  // (one nav dot each) — cap it so the full set doesn't render 90+ dots.
  // The modal sidebar still receives the complete list for endless scroll.
  const popupReviews = reviews.slice(0, 6)

  // Review popup visible unless hovering images (but not when hovering the popup itself)
  const showReviewPopup = !isHoveringImages || isHoveringReview

  const openModal = () => setIsModalOpen(true)

  return (
    <>
      <div className="relative">
        <DesktopGalleryGrid
          allImages={allImages}
          gridImages={gridImages}
          hasVideo={!!videoUrl}
          videoUrl={videoUrl}
          title={title}
          onOpenModal={openModal}
          onHoverImages={setIsHoveringImages}
        />

        <MobileCarousel images={allImages} title={title} onTap={openModal} />

        <ReviewPopup
          reviews={popupReviews}
          totalReviews={totalReviews}
          avgRating={avgRating}
          visible={showReviewPopup}
          onHoverChange={setIsHoveringReview}
        />
      </div>

      {isModalOpen && (
        <GalleryModal
          images={allImages}
          videoUrl={videoUrl}
          title={title}
          reviews={reviews}
          reviewCount={totalReviews}
          avgRating={avgRating}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  )
}
