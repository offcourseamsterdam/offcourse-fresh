import { describe, it, expect } from 'vitest'
import { bookingsSource } from './bookings'
import { fakeSupabase } from './test-helpers'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asSupabase = (s: unknown) => s as any

const rows = [
  { id: '1', customer_name: 'Diana de Vries', customer_email: 'diana@example.com', listing_title: 'Private Hidden Gems', booking_date: '2026-09-20', stripe_amount: 33000, booking_source: 'website', created_at: '2026-09-01' },
  { id: '2', customer_name: 'Someone Else', listing_title: 'Shared Cruise', booking_date: '2026-09-21', stripe_amount: 8800, booking_source: 'viator', created_at: '2026-09-02' },
  { id: '3', customer_name: 'A Third Guest', listing_title: 'Sunset Cruise', booking_date: '2026-09-22', stripe_amount: 12000, booking_source: 'boatlocal', created_at: '2026-09-03' },
]

describe('bookingsSource', () => {
  it('finds a booking by guest name', async () => {
    const results = await bookingsSource.search(asSupabase(fakeSupabase({ bookings: rows })), 'diana')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Diana de Vries')
    expect(results[0].href).toBe('/admin/bookings?booking=1')
  })
  it('finds a booking by email', async () => {
    const results = await bookingsSource.search(asSupabase(fakeSupabase({ bookings: rows })), 'diana@example.com')
    expect(results).toHaveLength(1)
  })
  it('"viator" surfaces bookings with booking_source=viator, not just a text match', async () => {
    const results = await bookingsSource.search(asSupabase(fakeSupabase({ bookings: rows })), 'viator')
    expect(results.map(r => r.title)).toContain('Someone Else')
  })
  it('"boatlocal" surfaces bookings from that source', async () => {
    const results = await bookingsSource.search(asSupabase(fakeSupabase({ bookings: rows })), 'boatlocal')
    expect(results.map(r => r.title)).toContain('A Third Guest')
  })
  it('does not duplicate a row that matches both the text search and the source keyword', async () => {
    const withViatorName = [...rows, { id: '4', customer_name: 'Viator Fan', booking_source: 'viator', created_at: '2026-09-04' }]
    const results = await bookingsSource.search(asSupabase(fakeSupabase({ bookings: withViatorName })), 'viator')
    const ids = results.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('returns nothing for an empty query', async () => {
    const results = await bookingsSource.search(asSupabase(fakeSupabase({ bookings: rows })), '   ')
    expect(results).toEqual([])
  })
  it('subtitle includes cruise, date and amount', async () => {
    const results = await bookingsSource.search(asSupabase(fakeSupabase({ bookings: rows })), 'diana')
    expect(results[0].subtitle).toContain('Private Hidden Gems')
    expect(results[0].subtitle).toContain('€330')
  })
  it('finds a booking by Stripe payment intent id, matching the bookings page\'s own search box', async () => {
    const withPi = [...rows, { id: '5', customer_name: 'Pi Guest', stripe_payment_intent_id: 'pi_abc123', created_at: '2026-09-05' }]
    // escapeIlike strips `_` (a SQL LIKE wildcard) — a separate, pre-existing characteristic,
    // not part of this fix — so search on a substring without one rather than the full id.
    const results = await bookingsSource.search(asSupabase(fakeSupabase({ bookings: withPi })), 'abc123')
    expect(results.map(r => r.title)).toContain('Pi Guest')
  })
  it('returns nothing (not the most recent bookings) for a query that is only special characters', async () => {
    // ",," escapes down to an empty ilike pattern — must not fall back to "%%" (match everything).
    const results = await bookingsSource.search(asSupabase(fakeSupabase({ bookings: rows })), ',,')
    expect(results).toEqual([])
  })
})
