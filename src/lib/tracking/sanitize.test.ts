import { describe, it, expect } from 'vitest'
import { sanitizeUTMValue, isKnownSource, sanitizeUTMParams } from './sanitize'

describe('sanitizeUTMValue', () => {
  it('lowercases values', () => {
    expect(sanitizeUTMValue('GOOGLE')).toBe('google')
    expect(sanitizeUTMValue('Facebook')).toBe('facebook')
  })

  it('trims whitespace', () => {
    expect(sanitizeUTMValue('  google  ')).toBe('google')
  })

  it('strips values over 100 chars', () => {
    const long = 'a'.repeat(150)
    expect(sanitizeUTMValue(long)?.length).toBe(100)
  })

  it('removes special characters', () => {
    expect(sanitizeUTMValue('google<script>alert(1)</script>')).toBe('googlescriptalert1script')
  })

  it('allows hyphens, underscores, dots', () => {
    expect(sanitizeUTMValue('summer-2024_campaign.v2')).toBe('summer-2024_campaign.v2')
  })

  it('returns null for empty values', () => {
    expect(sanitizeUTMValue('')).toBe(null)
    expect(sanitizeUTMValue(null)).toBe(null)
    expect(sanitizeUTMValue(undefined)).toBe(null)
  })
})

describe('isKnownSource', () => {
  it('recognizes known sources', () => {
    expect(isKnownSource('google')).toBe(true)
    expect(isKnownSource('instagram')).toBe(true)
    expect(isKnownSource('withlocals')).toBe(true)
  })

  it('rejects unknown sources', () => {
    expect(isKnownSource('randomjunk')).toBe(false)
    expect(isKnownSource('hackerman')).toBe(false)
  })

  it('handles null', () => {
    expect(isKnownSource(null)).toBe(false)
  })
})

describe('sanitizeUTMParams', () => {
  it('sanitizes all params and flags verified source', () => {
    const result = sanitizeUTMParams({
      utm_source: 'GOOGLE',
      utm_medium: 'CPC',
      utm_campaign: 'Summer Sale',
    })
    expect(result.utm_source).toBe('google')
    expect(result.utm_medium).toBe('cpc')
    expect(result.utm_campaign).toBe('summersale') // spaces stripped
    expect(result.is_verified_source).toBe(true)
  })

  it('flags unverified source', () => {
    const result = sanitizeUTMParams({ utm_source: 'randomsite' })
    expect(result.utm_source).toBe('randomsite')
    expect(result.is_verified_source).toBe(false)
  })
})
