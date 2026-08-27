import { describe, it, expect } from 'vitest'
import {
  extractFirstName,
  normalizeNameCasing,
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

  it('title-cases an ALL CAPS name (real case: booking stored as "KARL LAMEYNARDIE")', () => {
    expect(extractFirstName('KARL LAMEYNARDIE')).toBe('Karl')
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

// ── normalizeNameCasing ──────────────────────────────────────────────────────

describe('normalizeNameCasing', () => {
  it('title-cases an ALL CAPS name', () => {
    expect(normalizeNameCasing('KARL')).toBe('Karl')
  })

  it('title-cases an all-lowercase name', () => {
    expect(normalizeNameCasing('karl')).toBe('Karl')
  })

  it('capitalizes after a hyphen', () => {
    expect(normalizeNameCasing('ANNA-MARIE')).toBe('Anna-Marie')
    expect(normalizeNameCasing('anna-marie')).toBe('Anna-Marie')
  })

  it('capitalizes after an apostrophe', () => {
    expect(normalizeNameCasing("O'BRIEN")).toBe("O'Brien")
    expect(normalizeNameCasing("o'brien")).toBe("O'Brien")
  })

  it('leaves already mixed-case names untouched, even unusual capitalization', () => {
    expect(normalizeNameCasing('McDonald')).toBe('McDonald')
    expect(normalizeNameCasing('DiCaprio')).toBe('DiCaprio')
    expect(normalizeNameCasing('Anna-Marie')).toBe('Anna-Marie')
  })

  it('is a no-op on a name with no letters', () => {
    expect(normalizeNameCasing('123')).toBe('123')
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

  it('interpolates all four tokens into the default template', () => {
    const result = formatReviewSms(baseParams)
    expect(result).toContain('Hi John!')
    expect(result).toContain('Sunset Canal Cruise')
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

  it('falls back to "the cruise" when listingTitle is null', () => {
    const result = formatReviewSms({ ...baseParams, listingTitle: null })
    expect(result).toContain('the cruise')
  })

  it('falls back to "the cruise" when listingTitle is empty', () => {
    const result = formatReviewSms({ ...baseParams, listingTitle: '' })
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
    expect(result).toContain('The Off Course Team')
  })

  it('falls back to default template when custom template is whitespace-only', () => {
    const result = formatReviewSms({ ...baseParams, template: '   ' })
    expect(result).toContain('The Off Course Team')
  })

  it('replaces all occurrences of each token (no leftover placeholders)', () => {
    const result = formatReviewSms(baseParams)
    expect(result).not.toContain('{firstName}')
    expect(result).not.toContain('{listingTitle}')
    expect(result).not.toContain('{mapUrl}')
    expect(result).not.toContain('{reviewUrl}')
    expect(result).not.toContain('{captainName}')
    expect(result).not.toContain('{signOff}')
  })

  it('DEFAULT_SMS_TEMPLATE contains all token placeholders', () => {
    expect(DEFAULT_SMS_TEMPLATE).toContain('{firstName}')
    expect(DEFAULT_SMS_TEMPLATE).toContain('{listingTitle}')
    expect(DEFAULT_SMS_TEMPLATE).toContain('{mapUrl}')
    expect(DEFAULT_SMS_TEMPLATE).toContain('{reviewUrl}')
    expect(DEFAULT_SMS_TEMPLATE).toContain('{signOff}')
  })

  it('signs off with the assigned captain\'s name when provided', () => {
    const result = formatReviewSms({ ...baseParams, captainName: 'Jannah' })
    expect(result).toContain('- Jannah & the Off Course team')
    expect(result).not.toContain('The Off Course Team')
  })

  it('falls back to "The Off Course Team" (no named person) when no captain is resolved', () => {
    const result = formatReviewSms({ ...baseParams, captainName: null })
    expect(result).toContain('- The Off Course Team')
    expect(result).not.toContain('Beer')
  })

  it('falls back to "The Off Course Team" when captainName is whitespace-only', () => {
    const result = formatReviewSms({ ...baseParams, captainName: '   ' })
    expect(result).toContain('- The Off Course Team')
  })

  it('DEFAULT_SMS_TEMPLATE is GSM-7-safe (no emoji, no em-dash) so it never forces UCS-2 encoding', () => {
    // A single non-GSM-7 character (emoji, em-dash, curly quote, ...) forces
    // the WHOLE message into UCS-2, cutting the per-segment limit from ~153
    // to ~67 characters and roughly doubling the billed segment count.
    // eslint-disable-next-line no-control-regex
    const GSM7_SAFE = /^[\x00-\x7F£¥€]*$/
    const rendered = formatReviewSms(baseParams)
    expect(GSM7_SAFE.test(rendered)).toBe(true)
  })

  it('bare {captainName} token falls back to "the crew" in a custom template when unresolved', () => {
    const result = formatReviewSms({
      ...baseParams,
      captainName: null,
      template: 'Skippered by {captainName}!',
    })
    expect(result).toBe('Skippered by the crew!')
  })

  it('bare {captainName} token resolves to the first name in a custom template', () => {
    const result = formatReviewSms({
      ...baseParams,
      captainName: 'Jannah',
      template: 'Skippered by {captainName}!',
    })
    expect(result).toBe('Skippered by Jannah!')
  })
})
