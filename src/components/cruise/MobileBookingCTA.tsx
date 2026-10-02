'use client'

import { useState, useEffect } from 'react'

interface MobileBookingCTAProps {
  /** Pride-only styling: the CTA gets a saturated rainbow gradient fill. */
  rainbowTheme?: boolean
  /** Light festival styling: glowing animated rainbow border. */
  festivalTheme?: boolean
}

export function MobileBookingCTA({ rainbowTheme, festivalTheme }: MobileBookingCTAProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const bookingEl = document.getElementById('booking')
    if (!bookingEl) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Hide the CTA when the booking section is visible
        setVisible(!entry.isIntersecting)
      },
      { threshold: 0.1 }
    )

    observer.observe(bookingEl)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 lg:hidden px-4 pb-4 pt-2 bg-gradient-to-t from-white via-white/90 to-transparent transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <a
        href="#booking"
        className={`block w-full text-center font-bold text-base py-3.5 rounded-xl transition-all ${
          festivalTheme
            ? 'btn-festival-glow text-[#141444] shadow-xl'
            : rainbowTheme
            // The gradient drifts through light yellow/green stops that don't
            // pass contrast against plain white text — the shadow keeps the
            // label readable through every phase of the animation.
            ? 'text-white bg-rainbow-vivid hover:opacity-90 [text-shadow:0_1px_3px_rgba(0,0,0,0.65),0_0_10px_rgba(0,0,0,0.35)]'
            : 'text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)]'
        }`}
      >
        See tickets and prices
      </a>
    </div>
  )
}
