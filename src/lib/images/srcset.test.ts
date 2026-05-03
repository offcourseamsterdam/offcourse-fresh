import { describe, it, expect } from 'vitest'
import { buildSrcSet, pickVariant } from './srcset'
import type { ImageAssetVariant } from './types'

const variants: ImageAssetVariant[] = [
  { width: 320, height: 240, avif_url: '/a/320.avif', webp_url: '/a/320.webp' },
  { width: 800, height: 600, avif_url: '/a/800.avif', webp_url: '/a/800.webp' },
  { width: 1600, height: 1200, avif_url: '/a/1600.avif', webp_url: '/a/1600.webp' },
]

describe('buildSrcSet', () => {
  it('builds an AVIF srcset sorted by width', () => {
    expect(buildSrcSet(variants, 'avif')).toBe(
      '/a/320.avif 320w, /a/800.avif 800w, /a/1600.avif 1600w',
    )
  })

  it('builds a WebP srcset', () => {
    expect(buildSrcSet(variants, 'webp')).toBe(
      '/a/320.webp 320w, /a/800.webp 800w, /a/1600.webp 1600w',
    )
  })

  it('handles unsorted input', () => {
    const shuffled = [variants[2], variants[0], variants[1]]
    expect(buildSrcSet(shuffled, 'avif')).toBe(
      '/a/320.avif 320w, /a/800.avif 800w, /a/1600.avif 1600w',
    )
  })

  it('returns empty string for empty input', () => {
    expect(buildSrcSet([], 'avif')).toBe('')
  })
})

describe('pickVariant', () => {
  it('picks the smallest variant >= target', () => {
    expect(pickVariant(variants, 500).width).toBe(800)
    expect(pickVariant(variants, 800).width).toBe(800)
  })

  it('falls back to the largest when target exceeds all', () => {
    expect(pickVariant(variants, 5000).width).toBe(1600)
  })

  it('picks smallest when target is below all', () => {
    expect(pickVariant(variants, 100).width).toBe(320)
  })
})
