import { describe, it, expect } from 'vitest'
import { matchMarkdownRoute, isHomepagePath } from './match-agent-route'

describe('matchMarkdownRoute', () => {
  it('matches a cruise page and captures the slug and locale', () => {
    expect(matchMarkdownRoute('/en/cruises/sunset-private-charter')).toEqual({
      pathname: '/api/markdown/cruises/sunset-private-charter',
      locale: 'en',
    })
  })

  it('matches a cruise page with a trailing slash', () => {
    expect(matchMarkdownRoute('/nl/cruises/sunset-private-charter/')).toEqual({
      pathname: '/api/markdown/cruises/sunset-private-charter',
      locale: 'nl',
    })
  })

  it('matches a blog post', () => {
    expect(matchMarkdownRoute('/de/blog/the-jordaan')).toEqual({
      pathname: '/api/markdown/blog/the-jordaan',
      locale: 'de',
    })
  })

  it('matches the homepage for every supported locale', () => {
    expect(matchMarkdownRoute('/en')).toEqual({ pathname: '/api/markdown/home', locale: 'en' })
    expect(matchMarkdownRoute('/zh/')).toEqual({ pathname: '/api/markdown/home', locale: 'zh' })
  })

  it('does not match the cruises listing page itself (no slug)', () => {
    expect(matchMarkdownRoute('/en/cruises')).toBeNull()
  })

  it('does not match the blog listing page itself (no slug)', () => {
    expect(matchMarkdownRoute('/en/blog')).toBeNull()
  })

  it('does not match protected or unrelated routes', () => {
    expect(matchMarkdownRoute('/en/admin/bookings')).toBeNull()
    expect(matchMarkdownRoute('/en/account')).toBeNull()
    expect(matchMarkdownRoute('/api/markdown/home')).toBeNull()
  })

  it('does not match an unrecognized locale', () => {
    expect(matchMarkdownRoute('/xx/cruises/sunset-private-charter')).toBeNull()
  })

  it('does not match a cruise slug with a nested extra segment', () => {
    expect(matchMarkdownRoute('/en/cruises/sunset-private-charter/reviews')).toBeNull()
  })
})

describe('isHomepagePath', () => {
  it('matches the locale-prefixed homepage, with or without a trailing slash', () => {
    expect(isHomepagePath('/en')).toBe(true)
    expect(isHomepagePath('/nl/')).toBe(true)
  })

  it('rejects any other page', () => {
    expect(isHomepagePath('/en/cruises')).toBe(false)
    expect(isHomepagePath('/en/cruises/sunset-private-charter')).toBe(false)
    expect(isHomepagePath('/')).toBe(false)
    expect(isHomepagePath('/xx')).toBe(false)
  })
})
