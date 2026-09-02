import { describe, it, expect } from 'vitest'
import {
  extractFirstName,
  formatReviewSms,
  DEFAULT_SMS_TEMPLATE,
} from './format-message'

// ── extractFirstName ─────────────────────────────────────────────────────────

describe('extractFirstName', () => {
  it('returns first word from a full name', () => {
    expect(extractFirstName('Beer Zoomers')).toBe('Beer')
  })

  it('handles hyphenated first name with surname', () => {
    expect(extractFirstName('Anna-Marie Smith')).toBe('Anna-Marie')
  })

  it('handles single name', () => {
    expect(extractFirstName('Maria')).toBe('Maria')
  })

  it('handles extra whitespace between words', () => {
    expect(extractFirstName('John  Doe')).toBe('John')
  })

  it('returns "there" for null', () => {
    expect(extractFirstName(null)).toBe('there')
  })

  it('returns "there" for undefined', () => {
    expect(extractFirstName(undefined)).toBe('there')
  })

  it('returns "there" for empty string', () => {
    expect(extractFirstName('')).toBe('there')
  })

  it('returns "there" for whitespace-only string', () => {
    expect(extractFirstName('   ')).toBe('there')
  })
})

// ── formatReviewSms ──────────────────────────────────────────────────────────

describe('formatReviewSms', () => {
  const baseParams = {
    customerName: 'John Doe',
    listingTitle: 'Sunset Canal Cruise',
    mapUrl: 'https://offcourseamsterdam.com/r/map',
    reviewUrl: 'https://offcourseamsterdam.com/r/review',
  }

  it('interpolates tokens into the default template', () => {
    const result = formatReviewSms(baseParams)
    expect(result).toContain('Hi John!')
    expect(result).toContain('https://offcourseamsterdam.com/r/map')
    expect(result).toContain('https://offcourseamsterdam.com/r/review')
  })

  it('always produces English text (contains "Thanks for cruising")', () => {
    const result = formatReviewSms(baseParams)
    expect(result).toMatch(/thanks for cruising/i)
  })

  it('uses "there" as firstName when customerName is null', () => {
    const result = formatReviewSms({ ...baseParams, customerName: null })
    expect(result).toContain('Hi there!')
  })

  it('falls back to "the cruise" when listingTitle is null (custom template)', () => {
    const custom = 'Hi {firstName}, thanks for joining us on {listingTitle}!'
    const result = formatReviewSms({ ...baseParams, listingTitle: null, template: custom })
    expect(result).toContain('the cruise')
  })

  it('falls back to "the cruise" when listingTitle is empty (custom template)', () => {
    const custom = 'Hi {firstName}, thanks for joining us on {listingTitle}!'
    const result = formatReviewSms({ ...baseParams, listingTitle: '', template: custom })
    expect(result).toContain('the cruise')
  })

  it('uses custom template when provided', () => {
    const custom = 'Hey {firstName}, nice cruise on {listingTitle}! Map: {mapUrl} Review: {reviewUrl}'
    const result = formatReviewSms({ ...baseParams, template: custom })
    expect(result).toBe('Hey John, nice cruise on Sunset Canal Cruise! Map: https://offcourseamsterdam.com/r/map Review: https://offcourseamsterdam.com/r/review')
  })

  it('falls back to default template when custom template is null', () => {
    const result = formatReviewSms({ ...baseParams, template: null })
    expect(result).toContain('Hi John!')
    expect(result).toContain('Beer & the Off Course team')
  })

  it('falls back to default template when custom template is whitespace-only', () => {
    const result = formatReviewSms({ ...baseParams, template: '   ' })
    expect(result).toContain('Beer & the Off Course team')
  })

  it('replaces all occurrences of each token (no leftover placeholders)', () => {
    const result = formatReviewSms(baseParams)
    expect(result).not.toContain('{firstName}')
    expect(result).not.toContain('{listingTitle}')
    expect(result).not.toContain('{mapUrl}')
    expect(result).not.toContain('{reviewUrl}')
    expect(result).not.toContain('{captainName}')
  })

  it('DEFAULT_SMS_TEMPLATE contains its token placeholders', () => {
    expect(DEFAULT_SMS_TEMPLATE).toContain('{firstName}')
    expect(DEFAULT_SMS_TEMPLATE).toContain('{mapUrl}')
    expect(DEFAULT_SMS_TEMPLATE).toContain('{reviewUrl}')
    expect(DEFAULT_SMS_TEMPLATE).toContain('{captainName}')
  })

  it('signs off with the assigned captain\'s name when provided', () => {
    const result = formatReviewSms({ ...baseParams, captainName: 'Jannah' })
    expect(result).toContain('— Jannah & the Off Course team')
    expect(result).not.toContain('Beer & the Off Course team')
  })

  it('falls back to "Beer" as the sign-off when no captain is resolved', () => {
    const result = formatReviewSms({ ...baseParams, captainName: null })
    expect(result).toContain('— Beer & the Off Course team')
  })

  it('falls back to "Beer" when captainName is whitespace-only', () => {
    const result = formatReviewSms({ ...baseParams, captainName: '   ' })
    expect(result).toContain('— Beer & the Off Course team')
  })
})
