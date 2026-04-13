'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { SearchBar } from '@/components/search/SearchBar'
import { useRouter } from '@/i18n/navigation'
import { hideOnError } from '@/lib/utils/image'
import { useSearch } from '@/lib/search/SearchContext'

// ── Types ────────────────────────────────────────────────────────────────────

export type HeroSlide = {
  src: string
  alt: string
  caption: string
}

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
]

// ── Hook: responsive visible range ───────────────────────────────────────────

function useVisibleRange() {
  const [range, setRange] = useState(1) // default: 3 cards (±1)
  useEffect(() => {
    function update() {
      setRange(window.innerWidth >= 1280 ? 2 : 1)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return range
}

// ── Hook: card spacing ───────────────────────────────────────────────────────

function useCardSpacing() {
  const [spacing, setSpacing] = useState(68) // vw %
  useEffect(() => {
    function update() {
      // Desktop (xl+): 5 cards — use tighter spacing
      // Mobile/Tablet: 3 cards — wider spacing so sides cut off nicely
      setSpacing(window.innerWidth >= 1280 ? 33 : 68)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return spacing
}

// ── Component ────────────────────────────────────────────────────────────────

export function HeroSection({ slides = DEFAULT_SLIDES }: { slides?: HeroSlide[] }) {
  useTranslations('home.hero')
  const router = useRouter()
  const N = slides.length
  const [active, setActive] = useState(0)
  const heroSearchRef = useRef<HTMLDivElement>(null)
  const { setHeroSearchVisible, registerSearchHandler } = useSearch()
  const visibleRange = useVisibleRange()
  const cardSpacing = useCardSpacing()

  // Tell the navbar when hero search bar crosses the navbar edge
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setHeroSearchVisible(entry.isIntersecting),
      { threshold: 0, rootMargin: '-64px 0px 0px 0px' }
    )
    if (heroSearchRef.current) observer.observe(heroSearchRef.current)
    return () => observer.disconnect()
  }, [setHeroSearchVisible])

  // Auto-advance — always forward (consistent slide direction)
  useEffect(() => {
    const timer = setInterval(() => setActive(i => (i + 1) % N), 4500)
    return () => clearInterval(timer)
  }, [N])

  // Search handler
  const handleSearch = useCallback((date: string, guests: number) => {
    router.push(`/search?date=${date}&guests=${guests}`)
  }, [router])

  useEffect(() => {
    return registerSearchHandler(handleSearch)
  }, [registerSearchHandler, handleSearch])

  return (
    <section className="bg-texture-sand min-h-screen flex flex-col relative z-10" style={{ marginBottom: '-80px' }}>

      {/* ── Top: logo + headline + search ─── */}
      <div className="flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-6 pt-28 pb-3 relative z-20">

        {/* Hero logo */}
        <div className="mb-10">
          <Image
            src="/logos/logo-vertical.svg"
            alt="Off Course Amsterdam — Your Friend With A Boat"
            width={280}
            height={200}
            priority
            className="w-56 sm:w-64 h-auto"
          />
        </div>

        {/* Social proof */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(i => (
              <svg key={i} className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
          <span className="font-avenir text-sm text-muted">110+ reviews across platforms</span>
        </div>

        {/* Search bar */}
        <div ref={heroSearchRef} className="w-full max-w-2xl">
          <SearchBar onSearch={handleSearch} />
        </div>
      </div>

      {/* ── Polaroid carousel ─── */}
      <div
        className="relative w-full overflow-visible"
        style={{ height: 'clamp(240px, 30vh, 360px)' }}
      >
        {slides.map((slide, i) => {
          let dist = i - active
          // Wrap around for shortest path
          if (dist > N / 2) dist -= N
          if (dist < -N / 2) dist += N

          const isCenter = dist === 0
          const isVisible = Math.abs(dist) <= visibleRange

          // Subtle rotation — less than before, more editorial
          const rotation = isCenter ? 0.5 : dist > 0 ? 2 : -2

          // Dark overlay opacity: increases with distance
          const overlayOpacity = isCenter ? 0 : Math.min(0.6, Math.abs(dist) * 0.35)

          return (
            <div
              key={i}
              onClick={() => !isCenter && setActive(i)}
              className="absolute bottom-0"
              style={{
                left: '50%',
                width: 'clamp(220px, 36vw, 460px)',
                transform: `translateX(calc(-50% + ${dist * cardSpacing}vw)) rotate(${rotation}deg)`,
                transformOrigin: 'bottom center',
                zIndex: isCenter ? 20 : Math.max(1, 15 - Math.abs(dist) * 5),
                opacity: isVisible ? 1 : 0,
                pointerEvents: isVisible ? 'auto' : 'none',
                cursor: isCenter ? 'default' : 'pointer',
                // Squarespace-style: smooth horizontal slide, single easing
                transition: 'transform 900ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity 400ms ease',
                willChange: 'transform',
              }}
            >
              {/* Polaroid frame */}
              <div className="bg-white shadow-polaroid relative overflow-hidden" style={{ padding: '10px 10px 0 10px' }}>

                {/* Photo */}
                <div style={{ aspectRatio: '5/4' }} className="overflow-hidden bg-[#d1d5db] relative">
                  <img
                    src={slide.src}
                    alt={slide.alt}
                    className="w-full h-full object-cover"
                    onError={hideOnError}
                  />
                  {/* Dark overlay for side cards */}
                  <div
                    className="absolute inset-0 pointer-events-none transition-opacity duration-700"
                    style={{ background: `rgba(0,0,0,${overlayOpacity})` }}
                  />
                </div>

                {/* Caption area */}
                <div className="flex items-center justify-center" style={{ height: '48px' }}>
                  <p
                    className="font-palmore text-primary text-center leading-tight"
                    style={{ fontSize: 'clamp(15px, 1.6vw, 22px)' }}
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
