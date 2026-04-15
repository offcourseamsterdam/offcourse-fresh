'use client'

import { useState } from 'react'
import { GalleryModal } from './GalleryModal'
import { DesktopGalleryGrid } from './DesktopGalleryGrid'
import { MobileCarousel } from './MobileCarousel'
import { ReviewPopup } from './ReviewPopup'

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

  // All images: hero first, then the rest (deduplicated)
  const allImages = heroUrl
    ? [{ url: heroUrl, alt_text: title }, ...images.filter((img) => img.url !== heroUrl)]
    : images

  const gridImages = allImages.slice(1)
  const totalReviews = reviewCount ?? reviews.length

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
          reviews={reviews}
          totalReviews={totalReviews}
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
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  )
}
