'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchResults } from '@/components/search/SearchResults'
import type { SearchResult } from '@/types'
import { hideOnError } from '@/lib/utils/image'
import { useSearch } from '@/lib/search/SearchContext'

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
]

export function HeroSection({ slides = DEFAULT_SLIDES }: { slides?: HeroSlide[] }) {
  const t = useTranslations('home.hero')
  const N = slides.length
  const [active, setActive] = useState(0)
  const [searchState, setSearchState] = useState<{
    date: string
    guests: number
    results: SearchResult[]
    loading: boolean
    searched: boolean
  }>({
    date: '',
    guests: 2,
    results: [],
    loading: false,
    searched: false,
  })

  const resultsRef = useRef<HTMLDivElement>(null)
  const heroSearchRef = useRef<HTMLDivElement>(null)
  const { setHeroSearchVisible, registerSearchHandler } = useSearch()

  // Tell the navbar when hero search bar crosses the navbar edge
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setHeroSearchVisible(entry.isIntersecting)
      },
      // rootMargin top = -64px so it fires when element reaches the navbar bottom edge
      { threshold: 0, rootMargin: '-64px 0px 0px 0px' }
    )
    if (heroSearchRef.current) observer.observe(heroSearchRef.current)
    return () => observer.disconnect()
  }, [setHeroSearchVisible])

  // Auto-advance polaroid carousel
  useEffect(() => {
    const timer = setInterval(() => setActive(i => (i + 1) % N), 3500)
    return () => clearInterval(timer)
  }, [])

  // Register search handler so navbar can trigger searches via context
  const handleSearchStable = useCallback((date: string, guests: number) => {
    handleSearch(date, guests)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return registerSearchHandler(handleSearchStable)
  }, [registerSearchHandler, handleSearchStable])

  async function handleSearch(date: string, guests: number) {
    setSearchState(s => ({ ...s, loading: true, searched: true, date, guests }))
    try {
      const params = new URLSearchParams({ date, guests: String(guests) })
      const res = await fetch(`/api/search?${params}`)
      const json = await res.json()
      setSearchState(s => ({ ...s, loading: false, results: json.data?.results ?? [] }))
    } catch {
      setSearchState(s => ({ ...s, loading: false, results: [] }))
    }
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  return (
    <>
      <section className="bg-texture-sand min-h-screen flex flex-col relative z-10" style={{ marginBottom: '-140px' }}>

        {/* ── Top: logo + headline + search ────────────── */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-6 pt-28 pb-12 relative z-10">

          {/* Hero logo — vertical version */}
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
          <div className="flex items-center justify-center gap-2 mb-10">
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map(i => (
                <svg key={i} className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <span className="font-avenir text-sm text-muted">110+ reviews across platforms</span>
          </div>

          {/* Search bar — hero instance */}
          <div ref={heroSearchRef} className="w-full max-w-2xl">
            <SearchBar
              onSearch={handleSearch}
              loading={searchState.loading}
              initialDate={searchState.date}
              initialGuests={searchState.guests}
            />
          </div>
        </div>

        {/* ── Bottom: polaroid carousel ─────────────── */}
        <div className="relative w-full overflow-visible" style={{ height: '480px' }}>
          {slides.map((slide, i) => {
            let dist = i - active
            if (dist > N / 2) dist -= N
            if (dist < -N / 2) dist += N

            const isCenter = dist === 0
            // Rotation: center nearly flat, sides slightly tilted
            const rotation = isCenter ? 1 : dist > 0 ? 3 : -3

            return (
              <div
                key={i}
                onClick={() => !isCenter && setActive(i)}
                className="absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                  left: '50%',
                  transform: `translateX(calc(-50% + ${dist * 62}%)) scale(${isCenter ? 1 : 0.72}) rotate(${rotation}deg)`,
                  transformOrigin: 'bottom center',
                  zIndex: isCenter ? 10 : 5,
                  opacity: Math.abs(dist) > 1 ? 0 : isCenter ? 1 : 0.7,
                  pointerEvents: Math.abs(dist) > 1 ? 'none' : 'auto',
                  cursor: isCenter ? 'default' : 'pointer',
                }}
              >
                {/* Polaroid frame */}
                <div className="bg-white shadow-polaroid p-3 sm:p-4" style={{ width: 'clamp(240px, 30vw, 380px)' }}>
                  {/* Photo area */}
                  <div className="aspect-[4/3] overflow-hidden bg-[#d1d5db]">
                    <img
                      src={slide.src}
                      alt={slide.alt}
                      className="w-full h-full object-cover"
                      onError={hideOnError}
                    />
                  </div>
                  {/* Caption area */}
                  <div className="flex items-center justify-center" style={{ height: '64px' }}>
                    <p className="font-palmore text-primary text-center leading-tight"
                      style={{ fontSize: 'clamp(14px, 1.4vw, 18px)' }}>
                      {slide.caption}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Search results below hero */}
      {searchState.searched && (
        <div ref={resultsRef} className="relative z-0">
          <SearchResults
            results={searchState.results}
            date={searchState.date}
            guests={searchState.guests}
            loading={searchState.loading}
          />
        </div>
      )}
    </>
  )
}
