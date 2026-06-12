import { describe, it, expect } from 'vitest'
import { deriveTrafficSource, parseFirstTouch } from './traffic-source'

describe('deriveTrafficSource', () => {
  it('gclid wins over everything → google-ads', () => {
    const r = deriveTrafficSource({
      gclid: 'Cj0KCQ',
      campaignSlug: 'first-private-cruise-campaign',
      firstTouch: { ref: 'www.instagram.com' },
    })
    expect(r).toEqual({ source: 'google-ads', detail: 'first-private-cruise-campaign' })
  })

  it('gclid without campaign falls back to utm_campaign detail', () => {
    const r = deriveTrafficSource({ gclid: 'abc', firstTouch: { cmp: 'summer-sale' } })
    expect(r).toEqual({ source: 'google-ads', detail: 'summer-sale' })
  })

  it('gclid alone → google-ads with null detail', () => {
    expect(deriveTrafficSource({ gclid: 'abc' })).toEqual({ source: 'google-ads', detail: null })
  })

  it('whitespace-only gclid is ignored', () => {
    expect(deriveTrafficSource({ gclid: '  ' })).toEqual({ source: 'direct', detail: null })
  })

  it('campaign link without gclid → campaign + slug', () => {
    const r = deriveTrafficSource({ campaignSlug: 'qr-raam' })
    expect(r).toEqual({ source: 'campaign', detail: 'qr-raam' })
  })

  it('utm cpc medium → google-ads channel', () => {
    const r = deriveTrafficSource({ firstTouch: { src: 'google', med: 'cpc' } })
    expect(r).toEqual({ source: 'google-ads', detail: 'google' })
  })

  it('instagram referrer → social', () => {
    const r = deriveTrafficSource({ firstTouch: { ref: 'l.instagram.com' } })
    expect(r).toEqual({ source: 'social', detail: 'l.instagram.com' })
  })

  it('google referrer without utm → organic', () => {
    const r = deriveTrafficSource({ firstTouch: { ref: 'www.google.com' } })
    expect(r).toEqual({ source: 'organic', detail: 'www.google.com' })
  })

  it('unknown referrer → referral with host detail', () => {
    const r = deriveTrafficSource({ firstTouch: { ref: 'someblog.nl' } })
    expect(r).toEqual({ source: 'referral', detail: 'someblog.nl' })
  })

  it('no signals at all → direct', () => {
    expect(deriveTrafficSource({})).toEqual({ source: 'direct', detail: null })
  })

  it('first-touch with only landing path (direct visit) → direct', () => {
    expect(deriveTrafficSource({ firstTouch: { lp: '/en' } })).toEqual({ source: 'direct', detail: null })
  })
})

describe('parseFirstTouch', () => {
  it('parses a valid cookie payload', () => {
    const raw = JSON.stringify({ ref: 'www.google.com', src: 'google', lp: '/en', ts: 1718000000 })
    expect(parseFirstTouch(raw)).toEqual({ ref: 'www.google.com', src: 'google', lp: '/en', ts: 1718000000 })
  })

  it('returns null for malformed JSON', () => {
    expect(parseFirstTouch('not-json{')).toBeNull()
  })

  it('returns null for non-object JSON', () => {
    expect(parseFirstTouch('"a string"')).toBeNull()
    expect(parseFirstTouch('[1,2]')).toBeNull()
  })

  it('returns null for empty/missing input', () => {
    expect(parseFirstTouch(null)).toBeNull()
    expect(parseFirstTouch(undefined)).toBeNull()
    expect(parseFirstTouch('')).toBeNull()
    expect(parseFirstTouch('{}')).toBeNull()
  })

  it('drops non-string fields and caps length', () => {
    const raw = JSON.stringify({ ref: 'x'.repeat(500), src: 123, med: { evil: true } })
    const parsed = parseFirstTouch(raw)
    expect(parsed?.ref).toHaveLength(200)
    expect(parsed?.src).toBeUndefined()
    expect(parsed?.med).toBeUndefined()
  })

  it('ignores non-finite ts', () => {
    expect(parseFirstTouch(JSON.stringify({ src: 'google', ts: 'NaN' }))?.ts).toBeUndefined()
  })
})
