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
    <div className="sm:hidden relative">
      <div
        ref={scrollRef}
        className="flex overflow-x-auto scrollbar-hide rounded-2xl"
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
              priority={i === 0}
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
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          {images.map((_, i) => (
            <span
              key={i}
              className={`block rounded-full transition-all duration-200 ${
                i === activeIndex ? 'w-2 h-2 bg-white' : 'w-1.5 h-1.5 bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
