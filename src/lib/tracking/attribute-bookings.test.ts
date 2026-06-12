import { describe, it, expect } from 'vitest'
import { attributeBookingsToChannels, attributeSourcelessBookings, bookingRevenueCents } from './queries'

describe('attributeBookingsToChannels', () => {
  const channelBySession = new Map<string, string | null>([
    ['s1', 'ch-partners'],
    ['s2', 'ch-partners'],
    ['s3', 'ch-google'],
    ['s4', null], // session exists but has no channel
  ])

  it('sums bookings and revenue per channel', () => {
    const result = attributeBookingsToChannels(
      [
        { session_id: 's1', stripe_amount: 40000 },
        { session_id: 's2', stripe_amount: 31000 },
        { session_id: 's3', stripe_amount: 7000 },
      ],
      channelBySession,
    )
    expect(result.get('ch-partners')).toEqual({ bookings: 2, revenue_cents: 71000 })
    expect(result.get('ch-google')).toEqual({ bookings: 1, revenue_cents: 7000 })
  })

  it('counts multiple bookings from the same session', () => {
    const result = attributeBookingsToChannels(
      [
        { session_id: 's1', stripe_amount: 100 },
        { session_id: 's1', stripe_amount: 200 },
      ],
      channelBySession,
    )
    expect(result.get('ch-partners')).toEqual({ bookings: 2, revenue_cents: 300 })
  })

  it('skips bookings whose session is unknown or channel-less', () => {
    const result = attributeBookingsToChannels(
      [
        { session_id: 's4', stripe_amount: 5000 },   // session has null channel
        { session_id: 'gone', stripe_amount: 5000 }, // session not in map
        { session_id: null, stripe_amount: 5000 },   // no session at all
      ],
      channelBySession,
    )
    expect(result.size).toBe(0)
  })

  it('treats null stripe_amount as zero revenue but still counts the booking', () => {
    const result = attributeBookingsToChannels(
      [{ session_id: 's3', stripe_amount: null }],
      channelBySession,
    )
    expect(result.get('ch-google')).toEqual({ bookings: 1, revenue_cents: 0 })
  })

  it('returns an empty map for no bookings', () => {
    expect(attributeBookingsToChannels([], channelBySession).size).toBe(0)
  })
})

describe('bookingRevenueCents', () => {
  it('prefers the Stripe charge when present', () => {
    expect(bookingRevenueCents({ stripe_amount: 7000, base_amount_cents: 6000 })).toBe(7000)
  })

  it('falls back to the booking amount when Stripe is 0 (paid on the platform)', () => {
    expect(bookingRevenueCents({ stripe_amount: 0, base_amount_cents: 3500 })).toBe(3500)
  })

  it('falls back to the booking amount when Stripe is null', () => {
    expect(bookingRevenueCents({ stripe_amount: null, base_amount_cents: 7000 })).toBe(7000)
  })

  it('returns 0 when both are missing', () => {
    expect(bookingRevenueCents({ stripe_amount: null, base_amount_cents: null })).toBe(0)
  })
})

describe('attributeSourcelessBookings', () => {
  it('credits marketplace bookings to platforms', () => {
    const result = attributeSourcelessBookings([
      { booking_source: 'getyourguide', stripe_amount: 0, base_amount_cents: 3500 },
      { booking_source: 'viator', stripe_amount: 22940, base_amount_cents: 22940 },
      { booking_source: 'getyourguide', stripe_amount: null, base_amount_cents: 7000 },
    ])
    expect(result.get('platforms')).toEqual({ bookings: 3, revenue_cents: 33440 })
  })

  it('credits session-less website and recovery bookings to direct', () => {
    const result = attributeSourcelessBookings([
      { booking_source: 'website', stripe_amount: 8901, base_amount_cents: 3500 },
      { booking_source: 'stripe_recovery', stripe_amount: 17803, base_amount_cents: 14000 },
    ])
    expect(result.get('direct')).toEqual({ bookings: 2, revenue_cents: 26704 })
  })

  it('leaves operational sources unattributed', () => {
    const result = attributeSourcelessBookings([
      { booking_source: 'complimentary', stripe_amount: null, base_amount_cents: 40000 },
      { booking_source: 'payment_link', stripe_amount: 10000, base_amount_cents: 10000 },
      { booking_source: null, stripe_amount: 5000, base_amount_cents: 5000 },
    ])
    expect(result.size).toBe(0)
  })

  it('is case-insensitive on booking_source', () => {
    const result = attributeSourcelessBookings([
      { booking_source: 'GetYourGuide', stripe_amount: 0, base_amount_cents: 3500 },
    ])
    expect(result.get('platforms')).toEqual({ bookings: 1, revenue_cents: 3500 })
  })
})
