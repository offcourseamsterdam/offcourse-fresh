'use client'

import { useState, useEffect } from 'react'

interface StickyBookingHeaderProps {
  title: string
  priceDisplay?: string | null
}

export function StickyBookingHeader({ title, priceDisplay }: StickyBookingHeaderProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const bookingEl = document.getElementById('booking')
    if (!bookingEl) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show sticky header when booking section is NOT visible
        setVisible(!entry.isIntersecting)
      },
      { threshold: 0, rootMargin: '-80px 0px 0px 0px' }
    )

    observer.observe(bookingEl)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className={`fixed top-16 left-0 right-0 z-[9998] lg:hidden bg-white/95 backdrop-blur-sm border-b border-gray-200 shadow-sm transition-transform duration-300 ${
        visible ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-avenir font-bold text-sm text-[var(--color-ink)] truncate">{title}</p>
          {priceDisplay && (
            <p className="text-xs text-[var(--color-muted)]">{priceDisplay}</p>
          )}
        </div>
        <a
          href="#booking"
          className="flex-shrink-0 bg-[var(--color-primary)] text-white font-bold text-xs px-4 py-2 rounded-lg hover:bg-[var(--color-primary-dark)] transition-colors"
        >
          Book now
        </a>
      </div>
    </div>
  )
}
