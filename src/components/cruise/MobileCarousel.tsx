'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import { OptimizedImage } from '@/components/ui/OptimizedImage'
import type { GalleryImage } from './ImageGallery'

interface MobileCarouselProps {
  images: GalleryImage[]
  title: string
  onTap: () => void
}

// iOS-style page indicator: at most 7 dots. When there are more photos than fit,
// the dots on the edge that still has photos beyond the window shrink — the very
// last one smallest, the one before it medium — to hint there's more to scroll.
const MAX_DOTS = 7
function pageDots(active: number, total: number): { idx: number; scale: number }[] {
  if (total <= MAX_DOTS) {
    return Array.from({ length: total }, (_, idx) => ({ idx, scale: 1 }))
  }
  const start = Math.min(Math.max(active - 3, 0), total - MAX_DOTS)
  const moreBefore = start > 0
  const moreAfter = start + MAX_DOTS < total
  return Array.from({ length: MAX_DOTS }, (_, p) => {
    const idx = start + p
    let scale = 1
    if (moreBefore && p === 0) scale = 0.5
    else if (moreBefore && p === 1) scale = 0.75
    if (moreAfter && p === MAX_DOTS - 1) scale = 0.5
    else if (moreAfter && p === MAX_DOTS - 2) scale = 0.75
    return { idx, scale }
  })
}

export function MobileCarousel({ images, title, onTap }: MobileCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    function handleScroll() {
      if (!container) return
      const index = Math.round(container.scrollLeft / container.offsetWidth)
      setActiveIndex(index)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  function scrollToNext() {
    const container = scrollRef.current
    if (!container) return
    const nextIndex = Math.min(activeIndex + 1, images.length - 1)
    container.scrollTo({ left: nextIndex * container.offsetWidth, behavior: 'smooth' })
  }

  if (images.length === 0) return null

  return (
    <div className="sm:hidden relative left-1/2 -translate-x-1/2 w-screen">
      <div
        ref={scrollRef}
        className="flex overflow-x-auto scrollbar-hide"
        style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
      >
        {images.map((img, i) => (
          <button
            key={img.url}
            type="button"
            onClick={onTap}
            className="relative flex-shrink-0 w-full aspect-[16/10] focus:outline-none"
            style={{ scrollSnapAlign: 'start' }}
          >
            <OptimizedImage
              asset={img.asset}
              fallbackUrl={img.url}
              alt={img.alt_text ?? title}
              context="carousel"
              fill
              priority={false}
            />
          </button>
        ))}
      </div>

      {images.length > 1 && activeIndex < images.length - 1 && (
        <button
          type="button"
          onClick={scrollToNext}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center shadow-md"
          aria-label="Next image"
        >
          <ChevronRight className="w-4 h-4 text-[var(--color-ink)]" />
        </button>
      )}

      {images.length > 1 && (
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/20 backdrop-blur-sm"
          role="tablist"
          aria-label={`Photo ${activeIndex + 1} of ${images.length}`}
        >
          {pageDots(activeIndex, images.length).map(({ idx, scale }) => {
            const isActive = idx === activeIndex
            const px = Math.round((isActive ? 8 : 6) * scale)
            return (
              <span
                key={idx}
                role="tab"
                aria-selected={isActive}
                aria-label={`Photo ${idx + 1}`}
                style={{ width: px, height: px }}
                className={`block rounded-full transition-all duration-200 ${isActive ? 'bg-white' : 'bg-white/60'}`}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
