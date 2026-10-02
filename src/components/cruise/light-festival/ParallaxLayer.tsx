'use client'

import { useEffect, useRef, type ReactNode } from 'react'

interface ParallaxLayerProps {
  children: ReactNode
  /** How much slower than the page the layer scrolls (0 = fixed to page, 1 = pinned to screen). */
  speed?: number
}

// Moves its children down a fraction of the scroll distance, so the photo
// behind the hero text drifts slower than the page. Lives inside an
// overflow-hidden parent; it is made taller upward so the shift never shows a gap.
export function ParallaxLayer({ children, speed = 0.35 }: ParallaxLayerProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    const parent = el?.parentElement
    if (!el || !parent || matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    let onScreen = true
    const update = () => {
      raf = 0
      const scrolled = Math.min(Math.max(-parent.getBoundingClientRect().top, 0), parent.offsetHeight)
      el.style.transform = `translate3d(0, ${scrolled * speed}px, 0)`
    }
    const onScroll = () => { if (onScreen && !raf) raf = requestAnimationFrame(update) }

    const io = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting })
    io.observe(parent)
    addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      removeEventListener('scroll', onScroll)
      io.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [speed])

  // Extra height above (the speed fraction of the parent) covers the downward shift.
  return (
    <div
      ref={ref}
      className="absolute inset-x-0 bottom-0 -z-20 will-change-transform"
      style={{ top: `-${Math.round(speed * 100)}%` }}
    >
      {children}
    </div>
  )
}
