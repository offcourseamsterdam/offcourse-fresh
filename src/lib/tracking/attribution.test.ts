import { describe, it, expect } from 'vitest'
import { resolveChannelSlug, parseUTMFromURL, hasUTMParams, generateId } from './attribution'

describe('resolveChannelSlug', () => {
  it('returns google-ads for CPC medium', () => {
    expect(resolveChannelSlug('google', 'cpc')).toBe('google-ads')
    expect(resolveChannelSlug('google', 'ppc')).toBe('google-ads')
    expect(resolveChannelSlug('bing', 'paid')).toBe('google-ads')
  })

  it('returns social for known social sources', () => {
    expect(resolveChannelSlug('facebook', undefined)).toBe('social')
    expect(resolveChannelSlug('instagram', undefined)).toBe('social')
    expect(resolveChannelSlug('tiktok', undefined)).toBe('social')
    expect(resolveChannelSlug('linkedin', undefined)).toBe('social')
    expect(resolveChannelSlug('pinterest', undefined)).toBe('social')
  })

  it('returns social for social medium', () => {
    expect(resolveChannelSlug('buffer', 'social')).toBe('social')
  })

  it('returns email for email source or medium', () => {
    expect(resolveChannelSlug('email', undefined)).toBe('email')
    expect(resolveChannelSlug(undefined, 'email')).toBe('email')
    expect(resolveChannelSlug('newsletter', undefined)).toBe('email')
  })

  it('returns partners for partner/affiliate medium', () => {
    expect(resolveChannelSlug('cityguide', 'partner')).toBe('partners')
    expect(resolveChannelSlug('cityguide', 'affiliate')).toBe('partners')
  })

  it('returns referral for referral medium', () => {
    expect(resolveChannelSlug('somesite', 'referral')).toBe('referral')
  })

  it('returns organic for search engine referrers without UTM', () => {
    expect(resolveChannelSlug(undefined, undefined, 'https://www.google.com/search?q=boats')).toBe('organic')
    expect(resolveChannelSlug(undefined, undefined, 'https://duckduckgo.com/?q=amsterdam+boats')).toBe('organic')
    expect(resolveChannelSlug(undefined, undefined, 'https://www.bing.com/search?q=boats')).toBe('organic')
  })

  it('returns referral for non-search referrers without UTM', () => {
    expect(resolveChannelSlug(undefined, undefined, 'https://tripadvisor.com/some-page')).toBe('referral')
    expect(resolveChannelSlug(undefined, undefined, 'https://blog.example.com/best-boats')).toBe('referral')
  })

  it('returns direct when no UTM and no referrer', () => {
    expect(resolveChannelSlug(undefined, undefined, undefined)).toBe('direct')
    expect(resolveChannelSlug(undefined, undefined, '')).toBe('direct')
    expect(resolveChannelSlug(null, null, null)).toBe('direct')
  })

  it('is case-insensitive', () => {
    expect(resolveChannelSlug('Facebook', 'Social')).toBe('social')
    expect(resolveChannelSlug('GOOGLE', 'CPC')).toBe('google-ads')
    expect(resolveChannelSlug('Email', undefined)).toBe('email')
  })

  it('returns referral for unknown UTM source', () => {
    expect(resolveChannelSlug('random-site', undefined)).toBe('referral')
  })
})

describe('parseUTMFromURL', () => {
  it('extracts UTM parameters from URL', () => {
    const result = parseUTMFromURL('https://example.com?utm_source=google&utm_medium=cpc&utm_campaign=spring')
    expect(result).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'spring',
    })
  })

  it('returns empty object for URL without UTM', () => {
    expect(parseUTMFromURL('https://example.com')).toEqual({})
  })

  it('handles invalid URLs gracefully', () => {
    expect(parseUTMFromURL('not-a-url')).toEqual({})
  })

  it('ignores non-UTM parameters', () => {
    const result = parseUTMFromURL('https://example.com?utm_source=google&foo=bar&ref=123')
    expect(result).toEqual({ utm_source: 'google' })
  })
})

describe('hasUTMParams', () => {
  it('returns true when any UTM param is present', () => {
    expect(hasUTMParams({ utm_source: 'google' })).toBe(true)
    expect(hasUTMParams({ utm_medium: 'cpc' })).toBe(true)
  })

  it('returns false for empty UTM params', () => {
    expect(hasUTMParams({})).toBe(false)
  })
})

describe('generateId', () => {
  it('generates a UUID-like string', () => {
    const id = generateId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })
})
