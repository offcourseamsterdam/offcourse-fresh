import { describe, it, expect } from 'vitest'
import { buildForwardBody, forwardSubject, parseForwardTo } from './forward'

describe('parseForwardTo', () => {
  it('accepts and normalizes a single address', () => {
    expect(parseForwardTo('  Finance@OffCourseAmsterdam.com ')).toBe('finance@offcourseamsterdam.com')
  })
  it('rejects empty, non-strings and garbage', () => {
    expect(parseForwardTo('')).toBeNull()
    expect(parseForwardTo(undefined)).toBeNull()
    expect(parseForwardTo('finance')).toBeNull()
    expect(parseForwardTo('a@b.com, c@d.com')).toBeNull()
  })
})

describe('forwardSubject', () => {
  it('prefixes once', () => {
    expect(forwardSubject('Invoice 123')).toBe('Fwd: Invoice 123')
    expect(forwardSubject('Fwd: Invoice 123')).toBe('Fwd: Invoice 123')
    expect(forwardSubject('FW: Invoice')).toBe('FW: Invoice')
  })
  it('handles a missing subject', () => {
    expect(forwardSubject(null)).toBe('Fwd:')
  })
})

describe('buildForwardBody', () => {
  const base = {
    fromName: 'Jane',
    fromEmail: 'jane@example.com',
    sentAt: '2026-09-30T10:00:00Z',
    subject: 'Invoice',
    originalBody: 'Please find the invoice attached.',
  }

  it('includes the original message even without a note', () => {
    const body = buildForwardBody({ ...base, note: null })
    expect(body.startsWith('---------- Forwarded message ---------')).toBe(true)
    expect(body).toContain('From: Jane <jane@example.com>')
    expect(body).toContain('Subject: Invoice')
    expect(body).toContain('Please find the invoice attached.')
  })

  it('puts the note above the forwarded block', () => {
    const body = buildForwardBody({ ...base, note: 'For the books' })
    expect(body.indexOf('For the books')).toBeLessThan(body.indexOf('Forwarded message'))
  })

  it('falls back gracefully when the sender is unknown', () => {
    expect(buildForwardBody({ ...base, fromName: null, fromEmail: null, note: '' })).toContain('From: Unknown')
  })
})
