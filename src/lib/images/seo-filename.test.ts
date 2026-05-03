import { describe, it, expect } from 'vitest'
import { buildSeoFilename } from './seo-filename'

describe('buildSeoFilename', () => {
  it('joins keywords into a hyphen-separated slug', () => {
    expect(buildSeoFilename(['Amsterdam', 'canal', 'cruise'])).toBe('amsterdam-canal-cruise')
  })

  it('lowercases and strips punctuation', () => {
    expect(buildSeoFilename(['Diana Boat!', 'Sunset.'])).toBe('diana-boat-sunset')
  })

  it('deduplicates repeated keyword fragments', () => {
    expect(buildSeoFilename(['canal cruise', 'canal sunset', 'cruise sunset']))
      .toBe('canal-cruise-sunset')
  })

  it('returns fallback when input is empty', () => {
    expect(buildSeoFilename([])).toBe('image')
  })

  it('returns fallback when input only has empty strings', () => {
    expect(buildSeoFilename(['', '   ', '!!!'])).toBe('image')
  })

  it('truncates at the last word boundary when over 60 chars', () => {
    const out = buildSeoFilename([
      'amsterdam', 'canal', 'cruise', 'diana', 'sunset', 'jordaan',
      'evening', 'electric', 'boat', 'private', 'tour'
    ])
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.endsWith('-')).toBe(false)
  })

  it('handles non-ASCII gracefully via slugify', () => {
    // slugify strips non-word chars; "Curaçao" → "curaao" (acceptable)
    const out = buildSeoFilename(['Curaçao boat'])
    expect(out).toMatch(/^[a-z0-9-]+$/)
    expect(out).toContain('boat')
  })

  it('preserves keyword order', () => {
    expect(buildSeoFilename(['sunset', 'amsterdam', 'jordaan']))
      .toBe('sunset-amsterdam-jordaan')
  })
})
