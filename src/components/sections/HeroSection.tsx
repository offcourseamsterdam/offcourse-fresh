'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { SearchBar } from '@/components/search/SearchBar'
import { hideOnError } from '@/lib/utils/image'
import { useSearch } from '@/lib/search/SearchContext'

// ── Types ────────────────────────────────────────────────────────────────────

export type HeroSlide = {
  src: string
  alt: string
  caption: string
}

// 7 slides — dist=±3 is always the invisible buffer zone, making wraps seamless
const DEFAULT_SLIDES: HeroSlide[] = [
  {
    src: 'https://offcourseamsterdam.com/lovable-uploads/7bfebada-39ca-4fe1-9e54-d91a54bc47f9.png',
    alt: 'Amsterdam canal',
    caption: 'off the beaten canal',
  },
  {
    src: 'https://offcourseamsterdam.com/lovable-uploads/1d2e5c89-6175-4ec5-a8ba-11a7773a5b19.png',
    alt: 'Off Course boat',
    caption: 'help yourself',
  },
  {
    src: 'https://offcourseamsterdam.com/lovable-uploads/ad6c9d0c-cc35-4a89-91a7-7caed8b9b4d0.png',
    alt: 'Guests on boat',
    caption: 'kick off your shoes',
  },
  {
    src: 'https://offcourseamsterdam.com/lovable-uploads/7bfebada-39ca-4fe1-9e54-d91a54bc47f9.png',
    alt: 'Canal at golden hour',
    caption: 'we drift different',
  },
  {
    src: 'https://offcourseamsterdam.com/lovable-uploads/1d2e5c89-6175-4ec5-a8ba-11a7773a5b19.png',
    alt: 'Amsterdam hidden gems',
    caption: 'the real amsterdam',
  },
  {
    src: 'https://offcourseamsterdam.com/lovable-uploads/ad6c9d0c-cc35-4a89-91a7-7caed8b9b4d0.png',
    alt: 'Friends on the water',
    caption: 'your friend with a boat',
  },
  {
    src: 'https://offcourseamsterdam.com/lovable-uploads/7bfebada-39ca-4fe1-9e54-d91a54bc47f9.png',
    alt: 'Drifting through Amsterdam',
    caption: 'we drift different',
  },
]

// ── Component ────────────────────────────────────────────────────────────────

export function HeroSection({ slides = DEFAULT_SLIDES }: { slides?: HeroSlide[] }) {
  const N = slides.length
  const [active, setActive] = useState(0)
  const heroSearchRef = useRef<HTMLDivElement>(null)
  const { setHeroSearchVisible, registerSearchHandler } = useSearch()

  // Visible range: 2 on md+ (5 cards total), 1 on mobile (3 cards)
  // With N=7 and range=2: buffer at dist=±3 is always invisible → seamless wraps
  const [visibleRange, setVisibleRange] = useState(1)
  useEffect(() => {
    function update() { setVisibleRange(window.innerWidth >= 768 ? 2 : 1) }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Card spacing — tighter on desktop so 5 cards sit close together
  const [cardSpacing, setCardSpacing] = useState(50)
  useEffect(() => {
    function update() { setCardSpacing(window.innerWidth >= 768 ? 22 : 50) }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Tell the navbar when hero search bar crosses the navbar edge
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setHeroSearchVisible(entry.isIntersecting),
      { threshold: 0, rootMargin: '-64px 0px 0px 0px' }
    )
    if (heroSearchRef.current) observer.observe(heroSearchRef.current)
    return () => observer.disconnect()
  }, [setHeroSearchVisible])

  // Auto-advance — always forward so every card moves right → left
  useEffect(() => {
    const timer = setInterval(() => setActive(i => (i + 1) % N), 3500)
    return () => clearInterval(timer)
  }, [N])

  // Search handler — triggers inline results on homepage instead of navigating
  const { triggerHomepageSearch } = useSearch()
  const handleSearch = useCallback((date: string, guests: number) => {
    triggerHomepageSearch(date, guests)
  }, [triggerHomepageSearch])

  useEffect(() => {
    return registerSearchHandler(handleSearch)
  }, [registerSearchHandler, handleSearch])

  return (
    <section
      className="bg-texture-sand min-h-screen flex flex-col relative z-10"
      style={{ marginBottom: '-80px' }}
    >
      {/* ── Logo + search ─── */}
      <div className="flex flex-col items-center text-center px-4 sm:px-6 pt-28 pb-10 relative z-20">
        <div className="mb-8">
          <Image
            src="/logos/logo-vertical.svg"
            alt="Off Course Amsterdam — Your Friend With A Boat"
            width={280}
            height={200}
            priority
            className="w-56 sm:w-64 h-auto"
          />
        </div>
        <div ref={heroSearchRef} className="w-full max-w-2xl">
          <SearchBar onSearch={handleSearch} />
        </div>
      </div>

      {/* ── Polaroid carousel — sits below search, hovers over next section ─── */}
      <div
        className="relative w-full flex-1 overflow-hidden"
        style={{ minHeight: 'clamp(200px, 24vh, 280px)' }}
      >
        {slides.map((slide, i) => {
          let dist = i - active
          // Shortest-path wrap → dist always in [-(N/2), N/2]
          if (dist > N / 2) dist -= N
          if (dist < -N / 2) dist += N

          const isCenter = dist === 0
          const isVisible = Math.abs(dist) <= visibleRange

          // Subtle tilt — less on center, gentle lean on sides
          const rotation = isCenter ? 0.5 : dist > 0 ? 1.5 : -1.5

          // Side cards darken slightly
          const overlayOpacity = isCenter ? 0 : Math.min(0.5, Math.abs(dist) * 0.25)

          return (
            <div
              key={i}
              className="absolute bottom-0"
              style={{
                left: '50%',
                width: 'clamp(130px, 17vw, 220px)',
                transform: `translateX(calc(-50% + ${dist * cardSpacing}vw)) rotate(${rotation}deg)`,
                transformOrigin: 'bottom center',
                zIndex: isCenter ? 20 : Math.max(1, 15 - Math.abs(dist) * 5),
                opacity: isVisible ? 1 : 0,
                pointerEvents: 'none',
                // Slow, smooth slide — all cards drift the same direction
                transition: 'transform 1200ms cubic-bezier(0.4, 0, 0.2, 1), opacity 600ms ease',
                willChange: 'transform',
              }}
            >
              {/* Polaroid frame */}
              <div
                className="bg-white shadow-polaroid relative overflow-hidden"
                style={{ padding: '8px 8px 0 8px' }}
              >
                {/* Photo */}
                <div
                  style={{ aspectRatio: '5/4' }}
                  className="overflow-hidden bg-[#d1d5db] relative"
                >
                  <img
                    src={slide.src}
                    alt={slide.alt}
                    className="w-full h-full object-cover"
                    onError={hideOnError}
                  />
                  {/* Overlay for non-center cards */}
                  <div
                    className="absolute inset-0 pointer-events-none transition-opacity duration-700"
                    style={{ background: `rgba(0,0,0,${overlayOpacity})` }}
                  />
                </div>

                {/* Caption */}
                <div className="flex items-center justify-center" style={{ height: '38px' }}>
                  <p
                    className="font-palmore text-primary text-center leading-tight"
                    style={{ fontSize: 'clamp(12px, 1.3vw, 17px)' }}
                  >
                    {slide.caption}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
