import { describe, it, expect, vi, afterEach } from 'vitest'

// Regression test for the Vercel-only "ReferenceError: DOMMatrix is not
// defined" bug: pdfjs-dist's legacy Node build constructs a module-level
// `new DOMMatrix()` as soon as it's imported, and its own self-polyfill (via
// the optional native `@napi-rs/canvas` package) isn't reliable on Vercel's
// serverless bundler. This file must define `globalThis.DOMMatrix` before
// pdfjs-dist is ever imported, so pdfjs's own `if (!globalThis.DOMMatrix)`
// check finds it already satisfied and never needs the native fallback.
describe('pdfjs-node-polyfill', () => {
  const hadDOMMatrix = 'DOMMatrix' in globalThis
  const originalDOMMatrix = (globalThis as { DOMMatrix?: unknown }).DOMMatrix

  afterEach(() => {
    if (hadDOMMatrix) {
      ;(globalThis as { DOMMatrix?: unknown }).DOMMatrix = originalDOMMatrix
    } else {
      delete (globalThis as { DOMMatrix?: unknown }).DOMMatrix
    }
  })

  it('defines globalThis.DOMMatrix when the runtime has none — the exact gap that crashed pdfjs-dist on Vercel', async () => {
    delete (globalThis as { DOMMatrix?: unknown }).DOMMatrix
    vi.resetModules()

    await import('./pdfjs-node-polyfill')

    expect(globalThis.DOMMatrix).toBeDefined()
    expect(() => new (globalThis.DOMMatrix as new (init?: number[]) => unknown)()).not.toThrow()
  })

  it('does not override a real DOMMatrix if the runtime already provides one', async () => {
    class ExistingDOMMatrix {}
    ;(globalThis as { DOMMatrix?: unknown }).DOMMatrix = ExistingDOMMatrix
    vi.resetModules()

    await import('./pdfjs-node-polyfill')

    expect(globalThis.DOMMatrix).toBe(ExistingDOMMatrix)
  })

  it('implements enough real 2D affine matrix math to be safe if pdfjs ever exercises it', async () => {
    delete (globalThis as { DOMMatrix?: unknown }).DOMMatrix
    vi.resetModules()
    await import('./pdfjs-node-polyfill')

    interface Matrix {
      a: number; b: number; c: number; d: number; e: number; f: number
      translate(tx?: number, ty?: number): Matrix
      scale(sx?: number, sy?: number): Matrix
      multiplySelf(other: unknown): Matrix
      invertSelf(): Matrix
    }
    const DOMMatrixPolyfill = globalThis.DOMMatrix as new (init?: number[]) => Matrix

    const identity = new DOMMatrixPolyfill()
    expect([identity.a, identity.b, identity.c, identity.d, identity.e, identity.f]).toEqual([1, 0, 0, 1, 0, 0])

    const translated = new DOMMatrixPolyfill().translate(10, 20)
    expect(translated.e).toBe(10)
    expect(translated.f).toBe(20)

    const scaled = new DOMMatrixPolyfill().scale(2, 3)
    expect(scaled.a).toBe(2)
    expect(scaled.d).toBe(3)

    // translate then invert should return to the identity's e/f (0, 0)
    const inverted = new DOMMatrixPolyfill().translate(10, 20).invertSelf()
    expect(inverted.e).toBe(-10)
    expect(inverted.f).toBe(-20)
  })
})
