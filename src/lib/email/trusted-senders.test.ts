import { describe, it, expect } from 'vitest'
import { isTrustedEmailSender } from './trusted-senders'

describe('isTrustedEmailSender', () => {
  it('trusts the real GetYourGuide review-notification sender (a subdomain)', () => {
    expect(isTrustedEmailSender('do-not-reply@notification.getyourguide.com')).toBe(true)
  })

  it('trusts the bare domain too', () => {
    expect(isTrustedEmailSender('someone@getyourguide.com')).toBe(true)
  })

  it('does not trust an arbitrary customer address', () => {
    expect(isTrustedEmailSender('jane@example.com')).toBe(false)
  })

  it('does not trust a lookalike domain (prefix match, not a real subdomain)', () => {
    expect(isTrustedEmailSender('someone@notgetyourguide.com')).toBe(false)
  })

  it('is false for null/undefined/empty', () => {
    expect(isTrustedEmailSender(null)).toBe(false)
    expect(isTrustedEmailSender(undefined)).toBe(false)
    expect(isTrustedEmailSender('')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isTrustedEmailSender('Someone@GetYourGuide.COM')).toBe(true)
  })
})
