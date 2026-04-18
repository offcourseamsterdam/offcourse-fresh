'use client'

import { useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { SafeImage } from '@/components/ui/SafeImage'
import { SearchBar } from '@/components/search/SearchBar'
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
  const heroSearchRef = useRef<HTMLDivElement>(null)
  const { setHeroSearchVisible, registerSearchHandler } = useSearch()

  // Tell the navbar when hero search bar crosses the navbar edge
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setHeroSearchVisible(entry.isIntersecting),
      { threshold: 0, rootMargin: '-64px 0px 0px 0px' }
    )
    if (heroSearchRef.current) observer.observe(heroSearchRef.current)
    return () => observer.disconnect()
  }, [setHeroSearchVisible])

  // Search handler — triggers inline results on homepage instead of navigating
  const { triggerHomepageSearch } = useSearch()
  const handleSearch = useCallback((date: string, guests: number) => {
    triggerHomepageSearch(date, guests)
  }, [triggerHomepageSearch])

  useEffect(() => {
    return registerSearchHandler(handleSearch)
  }, [registerSearchHandler, handleSearch])

  // Duplicate slides for seamless marquee loop — 2 copies so translate-50% wraps perfectly
  const loopedSlides = [...slides, ...slides]

  return (
    <section
      className="bg-texture-sand min-h-screen flex flex-col relative z-10"
      style={{ marginBottom: '-140px' }}
    >
      {/* ── Logo + search ─── */}
      <div className="flex flex-col items-center text-center px-4 sm:px-6 pt-28 pb-10 relative z-20">
        {/* Decorative icons, scattered organically around the logo + search */}
        <Image
          src="/icons/hero-waves.svg"
          alt=""
          aria-hidden="true"
          width={200}
          height={80}
          className="hidden sm:block absolute left-6 md:left-14 lg:left-24 top-24 md:top-28 w-28 md:w-36 lg:w-44 h-auto pointer-events-none select-none"
          style={{ transform: 'rotate(-6deg)' }}
        />
        <Image
          src="/icons/hero-plant.svg"
          alt=""
          aria-hidden="true"
          width={140}
          height={180}
          className="hidden sm:block absolute left-4 md:left-12 lg:left-20 bottom-6 md:bottom-10 w-20 md:w-24 lg:w-28 h-auto pointer-events-none select-none"
          style={{ transform: 'rotate(-4deg)' }}
        />
        <Image
          src="/icons/hero-socks.svg"
          alt=""
          aria-hidden="true"
          width={160}
          height={130}
          className="hidden sm:block absolute right-6 md:right-14 lg:right-24 top-36 md:top-44 w-24 md:w-32 lg:w-40 h-auto pointer-events-none select-none"
          style={{ transform: 'rotate(8deg)' }}
        />

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

      {/* ── Polaroid marquee — endless left-to-right scroll, overlaps next section ─── */}
      <div
        className="relative w-full flex-1 overflow-hidden"
        style={{ minHeight: 'clamp(260px, 30vh, 360px)' }}
      >
        <div className="absolute bottom-0 left-0 flex items-end gap-6 sm:gap-8 animate-marquee-ltr will-change-transform">
          {loopedSlides.map((slide, i) => {
            // Alternate gentle tilts so each polaroid leans slightly different
            const rotation = ((i % 3) - 1) * 1.2
            return (
              <div
                key={i}
                className="flex-shrink-0"
                style={{
                  width: 'clamp(200px, 22vw, 300px)',
                  transform: `rotate(${rotation}deg)`,
                  transformOrigin: 'bottom center',
                }}
              >
                {/* Polaroid frame */}
                <div
                  className="bg-white shadow-polaroid relative overflow-hidden"
                  style={{ padding: '10px 10px 0 10px' }}
                >
                  {/* Photo */}
                  <div
                    style={{ aspectRatio: '5/4' }}
                    className="overflow-hidden bg-[#d1d5db] relative"
                  >
                    <SafeImage
                      src={slide.src}
                      alt={slide.alt}
                      fill
                      sizes="(max-width: 640px) 220px, (max-width: 1024px) 280px, 300px"
                      className="object-cover"
                      priority={i < 3}
                    />
                  </div>

                  {/* Caption */}
                  <div className="flex items-center justify-center" style={{ height: '44px' }}>
                    <p
                      className="font-palmore text-primary text-center leading-tight"
                      style={{ fontSize: 'clamp(13px, 1.4vw, 18px)' }}
                    >
                      {slide.caption}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
