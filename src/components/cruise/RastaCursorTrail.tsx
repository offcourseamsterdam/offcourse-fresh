'use client'

import { useEffect, useRef } from 'react'

// Reggae/Rastafari flag colors (green, gold, red) — not the official Jamaican
// government flag, which has no red (that's black/gold/green). Order matches
// how the trail bands and firework bursts cycle through them.
const RASTA_COLORS = ['#008542', '#FFE000', '#E70001']

function hexWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * A green/gold/red banner that trails behind the cursor, plus a firework-style
 * burst in the same three colors on click/tap. Rasta version of
 * RainbowCursorTrail (Pride), gated to the Curaçao Jamaican Buffet Cruise
 * listing in the cruise detail page.
 *
 * Where this diverges from the rainbow version: a rainbow reads as a smooth
 * sweep across the whole hue wheel, but a flag is 3 fixed stripes — so instead
 * of shifting a single line's hue along the trail, each segment is drawn 3
 * times as parallel bands offset perpendicular to the direction of travel
 * (green/gold/red), and burst particles cycle through the same 3 colors
 * instead of walking the hue wheel. Everything else (canvas setup, physics,
 * cleanup, reduced-motion/fine-pointer gating) mirrors RainbowCursorTrail —
 * see that file for the reasoning behind those choices.
 */
export function RastaCursorTrail() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return

    const hasFinePointer = window.matchMedia('(pointer: fine)').matches

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cnv = canvas
    const context = ctx

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

    type Point = { x: number; y: number; life: number }
    const points: Point[] = []
    const MAX_LIFE = 32

    let mouseX = -100
    let mouseY = -100
    let hasMoved = false

    const cleanupFns: Array<() => void> = []

    if (hasFinePointer) {
      const onMove = (e: MouseEvent) => {
        mouseX = e.clientX
        mouseY = e.clientY
        hasMoved = true
      }
      window.addEventListener('mousemove', onMove, { passive: true })
      const onLeave = () => { hasMoved = false }
      window.addEventListener('mouseout', onLeave)
      cleanupFns.push(
        () => window.removeEventListener('mousemove', onMove),
        () => window.removeEventListener('mouseout', onLeave),
      )
    }

    type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string }
    const particles: Particle[] = []
    const PARTICLE_LIFE = 26
    const PARTICLES_PER_SPLASH = 18

    function onPointerDown(e: PointerEvent) {
      for (let i = 0; i < PARTICLES_PER_SPLASH; i++) {
        const angle = (i / PARTICLES_PER_SPLASH) * Math.PI * 2 + Math.random() * 0.3
        const speed = 2.5 + Math.random() * 3.5
        particles.push({
          x: e.clientX,
          y: e.clientY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: PARTICLE_LIFE,
          color: RASTA_COLORS[i % RASTA_COLORS.length],
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
      for (const p of points) p.life -= 1
      while (points.length && points[0].life <= 0) points.shift()

      // Banner ribbon: 3 solid, touching green/gold/red bands offset
      // perpendicular to the direction of travel. Each band is ONE continuous
      // quadratic-smoothed path stroked once — drawing it segment-by-segment
      // (the previous approach) restrokes round line-caps at every joint,
      // which is exactly what reads as "a row of dots" instead of a ribbon.
      // A single stroke per band has caps only at its true start/end.
      if (points.length > 2) {
        const BAND_WIDTH = 5
        const OFFSET_STEP = BAND_WIDTH * 0.82 // < BAND_WIDTH so bands overlap slightly — no seam
        const head = points[points.length - 1]
        const tail = points[0]
        context.lineWidth = BAND_WIDTH

        // Central-difference normal at each point — smoother than a per-segment
        // normal, since it isn't thrown off by single noisy mousemove samples.
        const normals = points.map((_, i) => {
          const a = points[Math.max(0, i - 1)]
          const b = points[Math.min(points.length - 1, i + 1)]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const len = Math.hypot(dx, dy) || 1
          return { nx: -dy / len, ny: dx / len }
        })

        RASTA_COLORS.forEach((color, bandIndex) => {
          const offset = (bandIndex - 1) * OFFSET_STEP // -step, 0, +step
          const offsetPoints = points.map((p, i) => ({
            x: p.x + normals[i].nx * offset,
            y: p.y + normals[i].ny * offset,
          }))

          // Fade tail → head along the ribbon's own direction, so the color
          // itself carries the fade instead of restroking at varying alpha.
          //
          // One gradient stop PER POINT (not just a 2-stop tail/head sweep) —
          // each carries that point's own life ratio. This is what makes the
          // fade-out smooth: when the cursor stops moving, every point ages
          // together each frame, so the whole ribbon dims in place uniformly.
          // A 2-stop gradient instead recomputes its 0%/100% purely from the
          // tail/head *positions*, which jump discretely every time a dead
          // point gets shifted off the front — that positional jump is what
          // read as "flaky"/jerky, independent of the alpha math being right.
          // By the time a point's own stop reaches ~0 alpha (life → 0) it's
          // already invisible, so its removal from the array a moment later
          // is imperceptible instead of popping.
          const gradient = context.createLinearGradient(tail.x, tail.y, head.x, head.y)
          const lastIdx = points.length - 1
          points.forEach((p, i) => {
            const t = lastIdx > 0 ? i / lastIdx : 1
            gradient.addColorStop(t, hexWithAlpha(color, 0.65 * (p.life / MAX_LIFE)))
          })
          context.strokeStyle = gradient

          context.beginPath()
          context.moveTo(offsetPoints[0].x, offsetPoints[0].y)
          for (let i = 1; i < offsetPoints.length - 1; i++) {
            const mx = (offsetPoints[i].x + offsetPoints[i + 1].x) / 2
            const my = (offsetPoints[i].y + offsetPoints[i + 1].y) / 2
            context.quadraticCurveTo(offsetPoints[i].x, offsetPoints[i].y, mx, my)
          }
          const last = offsetPoints[offsetPoints.length - 1]
          context.lineTo(last.x, last.y)
          context.stroke()
        })
      }

      // Firework burst: radiate outward, shrink, and fade — same physics as
      // the rainbow splash, just cycling the 3 flag colors instead of hues.
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life -= 1
        if (p.life <= 0) {
          particles.splice(i, 1)
          continue
        }
        p.x += p.vx
        p.y += p.vy
        p.vx *= 0.94
        p.vy *= 0.94
        const lifeRatio = p.life / PARTICLE_LIFE
        context.beginPath()
        context.fillStyle = hexWithAlpha(p.color, 0.8 * lifeRatio)
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
      // Forces the canvas onto its own compositor layer so a fast scroll can't
      // leave a stale painted frame ("old dots") visible while the page content
      // underneath scrolls away — a known artifact on plain `position: fixed`
      // overlays that don't otherwise get GPU-composited independently.
      style={{ willChange: 'transform' }}
    />
  )
}
