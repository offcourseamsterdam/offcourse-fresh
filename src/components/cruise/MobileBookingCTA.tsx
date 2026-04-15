'use client'

import { useState, useEffect } from 'react'

export function MobileBookingCTA() {
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
      className={`fixed bottom-0 left-0 right-0 z-40 lg:hidden px-4 pb-4 pt-2 bg-gradient-to-t from-white via-white to-white/0 transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <a
        href="#booking"
        className="block w-full text-center bg-[var(--color-primary)] text-white font-bold text-base py-3.5 rounded-xl hover:bg-[var(--color-primary-dark)] transition-colors"
      >
        See tickets and prices
      </a>
    </div>
  )
}
