/**
 * Unit tests for the pure helpers exported from the book route.
 *
 * Importing from a Next.js route file is supported — Vitest treats it as a
 * regular TS module. The route's POST handler is not invoked here; only the
 * exported helpers are tested in isolation.
 */
import { describe, it, expect } from 'vitest'
import { pickBookingSessionId } from './route'

describe('pickBookingSessionId', () => {
  it('prefers the PaymentIntent metadata session (browsing session) over the body session', () => {
    // The bug: body.sessionId is read AFTER the payment redirect and points at the
    // orphan "/confirmation" session. The PI metadata holds the real browsing session.
    expect(pickBookingSessionId('browsing-session-abc', 'confirmation-orphan-xyz'))
      .toBe('browsing-session-abc')
  })

  it('falls back to the body session when there is no PI session (non-Stripe bookings)', () => {
    expect(pickBookingSessionId(null, 'body-session-123')).toBe('body-session-123')
    expect(pickBookingSessionId(undefined, 'body-session-123')).toBe('body-session-123')
  })

  it('returns null when neither source has a session', () => {
    expect(pickBookingSessionId(null, null)).toBeNull()
    expect(pickBookingSessionId(undefined, undefined)).toBeNull()
  })

  it('ignores an empty-string PI session and uses the body session', () => {
    expect(pickBookingSessionId('', 'body-session-123')).toBe('body-session-123')
  })
})
