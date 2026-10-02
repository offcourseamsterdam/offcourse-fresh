'use client'

import { useEffect, useRef } from 'react'

// Gentle snowfall drawn on a canvas that fills its (relatively positioned)
// parent. Pauses when off-screen and stays off for prefers-reduced-motion.
export function SnowCanvas({ density = 80 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    type Flake = { x: number; y: number; r: number; s: number; d: number; o: number }
    let w = 0, h = 0, flakes: Flake[] = [], raf = 0, onScreen = true

    const make = (anyY: boolean): Flake => {
      // Mix of small far-away flakes and a few big close ones, so it reads as snow at a glance.
      const r = Math.random() < 0.15 ? Math.random() * 2 + 3 : Math.random() * 2 + 1
      return { x: Math.random() * w, y: anyY ? Math.random() * h : -10, r, s: r * 0.22 + 0.2, d: Math.random() * Math.PI * 2, o: Math.random() * 0.35 + 0.6 }
    }
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      w = canvas.clientWidth; h = canvas.clientHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      flakes = Array.from({ length: Math.round(density * Math.min(1, w / 1200) + 20) }, () => make(true))
    }
    const tick = (t: number) => {
      ctx.clearRect(0, 0, w, h)
      for (const f of flakes) {
        f.y += f.s
        f.x += Math.sin(t / 2400 + f.d) * 0.3
        if (f.y > h + 10) Object.assign(f, make(false))
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${f.o})`
        ctx.shadowColor = 'rgba(255,255,255,0.8)'
        ctx.shadowBlur = f.r * 2
        ctx.fill()
      }
      if (onScreen) raf = requestAnimationFrame(tick)
    }

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      cancelAnimationFrame(raf)
      if (onScreen) raf = requestAnimationFrame(tick)
    })
    const ro = new ResizeObserver(resize)
    resize()
    io.observe(canvas)
    ro.observe(canvas)
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect() }
  }, [density])

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 w-full h-full" />
}
