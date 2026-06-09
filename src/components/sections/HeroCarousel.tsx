'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { SafeImage } from '@/components/ui/SafeImage'
import type { HeroSlide } from './HeroSection'

/**
 * Hero carousel — Squarespace-style 3-up showcase.
 *
 * Desktop (sm+): the active photo sits centre-stage in 16:9; the previous and
 * next photos peek in from the sides, dimmed and tilted in 3D. Hovering the left
 * photo shows a "Previous" pill, the right shows "Next" — click either (or use
 * arrow keys) to rotate. Auto-advances, pausing while hovered.
 *
 * Mobile (<sm): a single full-width 16:9 photo you swipe through (native
 * scroll-snap), with dots — no peeking sides, no hover pills (touch can't hover).
 *
 * Photos are decorative: they set the mood, they don't link anywhere.
 */

const AUTO_ADVANCE_MS = 5000

interface HeroCarouselProps {
  slides: HeroSlide[]
}

export function HeroCarousel({ slides }: HeroCarouselProps) {
  const n = slides.length
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hoverSide, setHoverSide] = useState<-1 | 1 | null>(null)

  const go = useCallback((dir: -1 | 1) => setIndex(i => (i + dir + n) % n), [n])
  const next = useCallback(() => go(1), [go])
  const prev = useCallback(() => go(-1), [go])

  // Auto-advance — only when >1 slide, not paused, and motion isn't reduced.
  useEffect(() => {
    if (n <= 1 || paused) return
    if (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setIndex(i => (i + 1) % n), AUTO_ADVANCE_MS)
    return () => clearInterval(id)
  }, [n, paused])

  if (n === 0) return null

  // Signed shortest distance from the active index (wraps around the ends).
  const offsetOf = (i: number) => {
    let d = i - index
    if (d > n / 2) d -= n
    if (d < -n / 2) d += n
    return d
  }

  const active = slides[index]

  return (
    <div className="w-full">
      {/* ── DESKTOP: 3-up center-stage ─────────────────────────────────── */}
      <div
        className="hidden sm:block relative w-full"
        style={{ height: 'clamp(240px, 46vh, 540px)', perspective: '1800px' }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => { setPaused(false); setHoverSide(null) }}
        tabIndex={0}
        role="group"
        aria-roledescription="carousel"
        aria-label="Off Course photos"
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
          if (e.key === 'ArrowRight') { e.preventDefault(); next() }
        }}
      >
        {slides.map((slide, i) => {
          const offset = offsetOf(i)
          // Only the active card and its immediate neighbours are visible;
          // ±2 is a hidden staging slot so cards glide in from behind.
          if (Math.abs(offset) > 2) return null

          const isCenter = offset === 0
          const isSide = offset === -1 || offset === 1
          const translateX = offset * 60          // % — how far the sides peek
          const scale = isCenter ? 1 : Math.abs(offset) === 1 ? 0.82 : 0.7
          const rotateY = offset === 0 ? 0 : offset < 0 ? 16 : -16
          const opacity = Math.abs(offset) <= 1 ? (isCenter ? 1 : 0.5) : 0
          const z = 30 - Math.abs(offset) * 10

          return (
            <div
              key={i}
              role={isSide ? 'button' : undefined}
              tabIndex={isSide ? 0 : undefined}
              aria-label={isSide ? (offset === -1 ? 'Previous photo' : 'Next photo') : undefined}
              aria-hidden={!isCenter}
              onClick={isSide ? () => go(offset as -1 | 1) : undefined}
              onKeyDown={isSide ? e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(offset as -1 | 1) }
              } : undefined}
              onMouseEnter={isSide ? () => setHoverSide(offset as -1 | 1) : undefined}
              onMouseLeave={isSide ? () => setHoverSide(null) : undefined}
              className="absolute top-1/2 left-1/2 h-full aspect-video rounded-2xl overflow-hidden bg-white/5"
              style={{
                transform: `translate(-50%, -50%) translateX(${translateX}%) scale(${scale}) rotateY(${rotateY}deg)`,
                opacity,
                zIndex: z,
                cursor: isSide ? 'pointer' : 'default',
                pointerEvents: Math.abs(offset) <= 1 ? 'auto' : 'none',
                boxShadow: isCenter
                  ? '0 30px 60px -15px rgba(0,0,0,0.5)'
                  : '0 20px 40px -20px rgba(0,0,0,0.4)',
                transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1), opacity 0.6s cubic-bezier(0.4,0,0.2,1)',
                willChange: 'transform, opacity',
              }}
            >
              <SafeImage
                src={slide.src}
                alt={slide.alt}
                fill
                sizes="(max-width: 1024px) 70vw, 900px"
                className="object-cover"
                priority={i === 0}
              />

              {/* Dim the side photos slightly so the centre reads as the focus. */}
              {isSide && <div className="absolute inset-0 bg-[#282888]/30" />}

              {/* Previous / Next pill — only on the hovered side photo. */}
              {isSide && hoverSide === offset && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="bg-white text-[#282888] font-avenir font-bold text-sm px-5 py-2.5 rounded-full shadow-xl flex items-center gap-2">
                    {offset === -1 ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Previous
                      </>
                    ) : (
                      <>
                        Next
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── MOBILE: swipeable single photo ─────────────────────────────── */}
      <MobileSlides slides={slides} index={index} onIndexChange={setIndex} />

      {/* ── Caption — mobile only (no gallery dots). On desktop the photos bleed
           over the next section, so a caption there would land on the wrong
           background; the photos carry the moment on their own. ─── */}
      {active.caption && (
        <div className="sm:hidden flex justify-center mt-5">
          <p
            key={index} /* re-mount → gentle fade as the caption changes */
            className="font-palmore text-white/90 text-center animate-[fadeIn_0.5s_ease]"
            style={{ fontSize: 'clamp(16px, 2vw, 22px)' }}
          >
            {active.caption}
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Mobile scroll-snap strip ──────────────────────────────────────────── */

function MobileSlides({
  slides,
  index,
  onIndexChange,
}: {
  slides: HeroSlide[]
  index: number
  onIndexChange: (i: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Keep the strip in sync when the dots / shared index change it externally.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const child = el.children[index] as HTMLElement | undefined
    if (!child) return
    const target = child.offsetLeft - (el.clientWidth - child.clientWidth) / 2
    if (Math.abs(el.scrollLeft - target) > 4) {
      el.scrollTo({ left: target, behavior: 'smooth' })
    }
  }, [index])

  // Report the snapped photo back up (for the shared dots + caption).
  function handleScroll() {
    const el = ref.current
    if (!el) return
    const center = el.scrollLeft + el.clientWidth / 2
    let closest = 0
    let best = Infinity
    Array.from(el.children).forEach((c, i) => {
      const child = c as HTMLElement
      const childCenter = child.offsetLeft + child.clientWidth / 2
      const dist = Math.abs(childCenter - center)
      if (dist < best) { best = dist; closest = i }
    })
    if (closest !== index) onIndexChange(closest)
  }

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      className="sm:hidden flex gap-3 overflow-x-auto snap-x snap-mandatory px-[7.5%] -mx-4 scrollbar-hide"
      style={{ scrollbarWidth: 'none' }}
    >
      {slides.map((slide, i) => (
        <div
          key={i}
          className="snap-center shrink-0 w-[85%] aspect-video rounded-2xl overflow-hidden relative bg-white/5"
          style={{ boxShadow: '0 20px 40px -20px rgba(0,0,0,0.5)' }}
        >
          <SafeImage
            src={slide.src}
            alt={slide.alt}
            fill
            sizes="85vw"
            className="object-cover"
            priority={i === 0}
          />
        </div>
      ))}
    </div>
  )
}
