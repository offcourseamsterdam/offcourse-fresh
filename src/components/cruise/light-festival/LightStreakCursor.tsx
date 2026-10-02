'use client'

import { useEffect, useRef } from 'react'

// A thin glowing neon streak that trails the mouse, like a light-art tube drawn
// through the air. Light Festival listing only (gated in cruises/[slug]/page.tsx).
// Mouse only (no cursor to trail on touch), off for prefers-reduced-motion,
// one fixed canvas with pointer-events:none so it never blocks a click.
const MAX_LIFE = 26 // frames a point stays visible (~0.4s at 60fps)

export function LightStreakCursor() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(pointer: fine)').matches) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(devicePixelRatio || 1, 2)
    const resize = () => {
      canvas.width = Math.floor(innerWidth * dpr)
      canvas.height = Math.floor(innerHeight * dpr)
      canvas.style.width = `${innerWidth}px`
      canvas.style.height = `${innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const points: { x: number; y: number; life: number }[] = []
    let hue = 280 // start violet, drift through magenta, amber, teal
    let raf = 0

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      points.push({ x: e.clientX, y: e.clientY, life: MAX_LIFE })
      if (points.length > 60) points.shift()
      if (!raf) raf = requestAnimationFrame(tick)
    }

    function tick() {
      ctx!.clearRect(0, 0, innerWidth, innerHeight)
      for (const p of points) p.life--
      while (points.length && points[0].life <= 0) points.shift()

      if (points.length > 1) {
        hue = (hue + 0.6) % 360
        ctx!.globalCompositeOperation = 'lighter'
        ctx!.lineCap = 'round'
        ctx!.lineJoin = 'round'
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i]
          const t = b.life / MAX_LIFE // 1 at the head, 0 at the tail
          const h = (hue + i * 4) % 360
          // Wide soft glow, then a thin bright core: reads as a lit neon tube.
          ctx!.strokeStyle = `hsla(${h}, 95%, 60%, ${0.35 * t})`
          ctx!.lineWidth = 10 * t + 2
          ctx!.shadowColor = `hsla(${h}, 100%, 60%, ${t})`
          ctx!.shadowBlur = 18
          ctx!.beginPath(); ctx!.moveTo(a.x, a.y); ctx!.lineTo(b.x, b.y); ctx!.stroke()
          ctx!.strokeStyle = `hsla(${h}, 100%, 88%, ${0.9 * t})`
          ctx!.lineWidth = 2.5 * t + 0.5
          ctx!.shadowBlur = 0
          ctx!.beginPath(); ctx!.moveTo(a.x, a.y); ctx!.lineTo(b.x, b.y); ctx!.stroke()
        }
        ctx!.globalCompositeOperation = 'source-over'
      }
      raf = points.length ? requestAnimationFrame(tick) : 0
    }

    addEventListener('pointermove', onMove, { passive: true })
    addEventListener('resize', resize)
    return () => {
      removeEventListener('pointermove', onMove)
      removeEventListener('resize', resize)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[9998]" />
}
