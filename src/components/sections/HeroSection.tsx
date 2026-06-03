'use client'

import { useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { SearchBar } from '@/components/search/SearchBar'
import { HeroCarousel } from './HeroCarousel'
import { useSearch } from '@/lib/search/SearchContext'
import { sectionRootStyle, type SectionStyle } from '@/lib/homepage/section-styles'

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
  {
    src: 'https://offcourseamsterdam.com/lovable-uploads/ad6c9d0c-cc35-4a89-91a7-7caed8b9b4d0.png',
    alt: 'Friends on the water',
    caption: 'your friend with a boat',
  },
]

// ── Component ────────────────────────────────────────────────────────────────

export function HeroSection({ slides = DEFAULT_SLIDES, reviewCount, sectionStyle }: { slides?: HeroSlide[]; reviewCount?: number; sectionStyle?: SectionStyle }) {
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

  return (
    <section className="bg-texture-purple-dark min-h-screen flex flex-col relative z-10" style={sectionRootStyle(sectionStyle)}>
      {/* ── Logo + headline + search ─── */}
      <div className="flex flex-col items-center text-center px-4 sm:px-6 pt-28 pb-8 relative z-30">
        {/* Decorative brand doodles — colourful accents floating around the lockup */}
        <Image
          src="/icons/hero-wave.png"
          alt=""
          aria-hidden="true"
          width={833}
          height={288}
          className="hidden sm:block absolute left-6 md:left-14 lg:left-24 top-24 md:top-28 w-28 md:w-36 lg:w-44 h-auto pointer-events-none select-none"
          style={{ transform: 'translateX(80px) rotate(-6deg)', opacity: 0.9 }}
        />
        <Image
          src="/icons/hero-plant-color.png"
          alt=""
          aria-hidden="true"
          width={581}
          height={752}
          className="hidden sm:block absolute left-4 md:left-12 lg:left-20 bottom-2 md:bottom-6 w-20 md:w-24 lg:w-28 h-auto pointer-events-none select-none"
          style={{ transform: 'rotate(-16deg)', opacity: 0.9 }}
        />
        <Image
          src="/icons/hero-sock-color.png"
          alt=""
          aria-hidden="true"
          width={524}
          height={432}
          className="hidden sm:block absolute right-6 md:right-14 lg:right-24 top-36 md:top-44 w-24 md:w-32 lg:w-40 h-auto pointer-events-none select-none"
          style={{ transform: 'rotate(8deg)', opacity: 0.9 }}
        />

        {/* Logo — SVG version (vector, 39 KB vs 99 KB PNG, crisp at all resolutions).
            unoptimized skips the Next.js image optimizer since SVGs don't need
            format conversion or resizing — they scale perfectly at any size.
            priority keeps fetchpriority="high" since the logo is the mobile LCP. */}
        <div className="mb-8">
          <Image
            src="/logos/logo-vertical.svg"
            alt="Off Course Amsterdam — Your Friend With A Boat"
            width={1497}
            height={1080}
            priority
            unoptimized
            className="w-56 sm:w-64 lg:w-72 h-auto"
          />
        </div>

        <div ref={heroSearchRef} className="w-full max-w-2xl">
          <SearchBar onSearch={handleSearch} />
        </div>

        {/* Social proof — sits just under the search bar */}
        <div className="mt-4 flex items-center justify-center gap-2 font-avenir text-sm text-white/85">
          <span className="text-[#fec200] tracking-tight" aria-hidden>★★★★★</span>
          <span>{reviewCount && reviewCount > 0 ? `${reviewCount}+` : '97+'} verified reviews</span>
        </div>
      </div>

      {/* ── Carousel — Squarespace-style 3-up showcase. On desktop it bleeds a
           little over the next section for that floating, layered feel. ─── */}
      <div className="flex-1 flex flex-col justify-center w-full px-4 sm:px-6 pb-10 sm:pb-0 relative z-10 sm:translate-y-10 lg:translate-y-14">
        <HeroCarousel slides={slides} />
      </div>
    </section>
  )
}
