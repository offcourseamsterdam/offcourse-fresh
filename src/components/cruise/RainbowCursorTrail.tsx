'use client'

import { useEffect, useRef } from 'react'

/**
 * A rainbow ribbon that trails behind the cursor, plus a rainbow splash burst
 * on click/tap. Pride-only easter egg — gated to the `pride-amsterdam-2026`
 * listing in the cruise detail page.
 *
 * Design notes:
 * - Canvas, not per-point DOM nodes. A trail is 20+ moving elements per frame;
 *   painting them to one <canvas> keeps it to a single composited layer instead
 *   of thrashing the DOM. pointer-events:none so it never blocks the page.
 * - The moving ribbon needs a fine pointer (mouse) — there's no persistent
 *   cursor to trail on touch. The click/tap splash has no such requirement, so
 *   it's wired to `pointerdown` (fires uniformly for mouse, touch, and pen)
 *   rather than gated behind the same fine-pointer check as the ribbon.
 * - Disabled entirely for anyone who asked the OS to reduce motion.
 * - The rainbow is baked in by walking the hue wheel — for the ribbon, along
 *   the trail (head is "now", tail fades over ~half a second); for a splash,
 *   around the burst's radial angle.
 */
export function RainbowCursorTrail() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return

    const hasFinePointer = window.matchMedia('(pointer: fine)').matches

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Non-null aliases: TypeScript doesn't carry the null-guards above into the
    // nested closures below, so bind them once here for the callbacks to close over.
    const cnv = canvas
    const context = ctx

    // Cap DPR at 2 — a rainbow ribbon doesn't need 3x retina pixels, and it
    // keeps the per-frame fill area (and battery cost) sane on high-DPI screens.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    function resize() {
      cnv.width = Math.floor(window.innerWidth * dpr)
      cnv.height = Math.floor(window.innerHeight * dpr)
      cnv.style.width = `${window.innerWidth}px`
      cnv.style.height = `${window.innerHeight}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // Trail buffer. Each entry is a cursor sample; `life` counts down to 0.
    type Point = { x: number; y: number; life: number }
    const points: Point[] = []
    const MAX_LIFE = 32 // frames a segment stays visible (~0.5s at 60fps)

    let mouseX = -100
    let mouseY = -100
    let hasMoved = false
    let hueShift = 0

    const cleanupFns: Array<() => void> = []

    if (hasFinePointer) {
      const onMove = (e: MouseEvent) => {
        mouseX = e.clientX
        mouseY = e.clientY
        hasMoved = true
      }
      window.addEventListener('mousemove', onMove, { passive: true })
      // Fade the whole ribbon out when the cursor leaves the window, so it
      // doesn't freeze mid-air at the edge.
      const onLeave = () => { hasMoved = false }
      window.addEventListener('mouseout', onLeave)
      cleanupFns.push(
        () => window.removeEventListener('mousemove', onMove),
        () => window.removeEventListener('mouseout', onLeave),
      )
    }

    // Splash burst on click/tap. `pointerdown` fires uniformly for mouse,
    // touch, and pen — unlike mousemove, this works with no fine pointer.
    type Particle = { x: number; y: number; vx: number; vy: number; life: number; hue: number }
    const particles: Particle[] = []
    const PARTICLE_LIFE = 26 // ~0.43s at 60fps
    const PARTICLES_PER_SPLASH = 16

    function onPointerDown(e: PointerEvent) {
      const baseHue = Math.random() * 360
      for (let i = 0; i < PARTICLES_PER_SPLASH; i++) {
        const angle = (i / PARTICLES_PER_SPLASH) * Math.PI * 2 + Math.random() * 0.3
        const speed = 2.5 + Math.random() * 3.5
        particles.push({
          x: e.clientX,
          y: e.clientY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: PARTICLE_LIFE,
          hue: (baseHue + (i / PARTICLES_PER_SPLASH) * 360) % 360,
        })
      }
    }
    window.addEventListener('pointerdown', onPointerDown, { passive: true })

    let raf = 0
    function frame() {
      context.clearRect(0, 0, cnv.width, cnv.height)
      context.globalCompositeOperation = 'lighter'
      context.lineCap = 'round'
      context.lineJoin = 'round'

      if (hasMoved) {
        points.push({ x: mouseX, y: mouseY, life: MAX_LIFE })
      }
      // Age every sample; drop the dead ones from the tail.
      for (const p of points) p.life -= 1
      while (points.length && points[0].life <= 0) points.shift()

      if (points.length > 1) {
        hueShift = (hueShift + 4) % 360
        for (let i = 1; i < points.length; i++) {
          const prev = points[i - 1]
          const curr = points[i]
          const t = i / points.length // 0 = tail, 1 = head
          const hue = (hueShift + t * 300) % 360
          context.strokeStyle = `hsla(${hue}, 95%, 60%, ${0.55 * (curr.life / MAX_LIFE)})`
          context.lineWidth = 2 + t * 12 // taper: thin tail, thick near the cursor
          context.beginPath()
          context.moveTo(prev.x, prev.y)
          context.lineTo(curr.x, curr.y)
          context.stroke()
        }
      }

      // Splash particles: radiate outward, shrink, and fade.
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life -= 1
        if (p.life <= 0) {
          particles.splice(i, 1)
          continue
        }
        p.x += p.vx
        p.y += p.vy
        p.vx *= 0.94 // friction — burst decelerates instead of flying forever
        p.vy *= 0.94
        const lifeRatio = p.life / PARTICLE_LIFE
        context.beginPath()
        context.fillStyle = `hsla(${p.hue}, 95%, 62%, ${0.75 * lifeRatio})`
        context.arc(p.x, p.y, 2.5 + 3.5 * lifeRatio, 0, Math.PI * 2)
        context.fill()
      }

      context.globalCompositeOperation = 'source-over'
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointerdown', onPointerDown)
      for (const fn of cleanupFns) fn()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60]"
    />
  )
}
