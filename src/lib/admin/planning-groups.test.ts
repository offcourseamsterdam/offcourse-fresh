import { describe, it, expect } from 'vitest'
import { groupBookingsForPlanning } from './planning-groups'
import type { AdminBooking } from './types'

function makeBooking(overrides: Partial<AdminBooking>): AdminBooking {
  return {
    id: 'id-' + Math.random(),
    created_at: '2026-07-01T00:00:00Z',
    booking_uuid: null,
    listing_id: 'listing-1',
    customer_name: 'Test Guest',
    customer_email: 'test@example.com',
    customer_phone: null,
    tour_item_name: null,
    listing_title: 'Off The Beaten Path Cruise',
    start_time: '2026-07-09T15:00:00+02:00',
    end_time: '2026-07-09T16:30:00+02:00',
    booking_date: '2026-07-09',
    guest_count: 2,
    category: 'shared',
    stripe_payment_intent_id: null,
    stripe_amount: null,
    status: 'confirmed',
    payment_status: 'paid',
    guest_note: null,
    booking_source: 'website',
    deposit_amount_cents: null,
    extras_selected: null,
    base_amount_cents: null,
    extras_amount_cents: null,
    base_vat_amount_cents: null,
    extras_vat_amount_cents: null,
    total_vat_amount_cents: null,
    catering_email_sent_at: null,
    customer_type_name: 'Diana - 2 Hours',
    campaign_name: null,
    promo_code: null,
    discount_amount_cents: null,
    partner_name: null,
    ...overrides,
  }
}

describe('groupBookingsForPlanning', () => {
  it('groups two shared bookings on the same slot + customer type into one block', () => {
    const a = makeBooking({ id: 'a', guest_count: 2, customer_name: 'Alice' })
    const b = makeBooking({ id: 'b', guest_count: 3, customer_name: 'Bob' })

    const groups = groupBookingsForPlanning([a, b])

    expect(groups).toHaveLength(1)
    expect(groups[0].bookings.map(x => x.id).sort()).toEqual(['a', 'b'])
    expect(groups[0].totalGuestCount).toBe(5)
  })

  it('keeps two private bookings on different slots as separate groups (the common case)', () => {
    const a = makeBooking({ id: 'a', category: 'private', start_time: '2026-07-09T14:00:00+02:00' })
    const b = makeBooking({ id: 'b', category: 'private', start_time: '2026-07-09T18:00:00+02:00' })

    const groups = groupBookingsForPlanning([a, b])

    expect(groups).toHaveLength(2)
  })

  it('does NOT group bookings on the same slot but a different customer type (different boat/duration)', () => {
    const a = makeBooking({ id: 'a', customer_type_name: 'Diana - 2 Hours' })
    const b = makeBooking({ id: 'b', customer_type_name: 'Curaçao - 2 Hours' })

    const groups = groupBookingsForPlanning([a, b])

    expect(groups).toHaveLength(2)
  })

  it('does NOT group bookings on the same time but a different date', () => {
    const a = makeBooking({ id: 'a', booking_date: '2026-07-09' })
    const b = makeBooking({ id: 'b', booking_date: '2026-07-10' })

    const groups = groupBookingsForPlanning([a, b])

    expect(groups).toHaveLength(2)
  })

  it('does NOT group bookings on the same slot but a different listing', () => {
    const a = makeBooking({ id: 'a', listing_id: 'listing-1' })
    const b = makeBooking({ id: 'b', listing_id: 'listing-2' })

    const groups = groupBookingsForPlanning([a, b])

    expect(groups).toHaveLength(2)
  })

  it('a single booking becomes a group of one', () => {
    const groups = groupBookingsForPlanning([makeBooking({ id: 'solo', guest_count: 4 })])

    expect(groups).toHaveLength(1)
    expect(groups[0].bookings).toHaveLength(1)
    expect(groups[0].totalGuestCount).toBe(4)
  })

  it('returns no groups for an empty list', () => {
    expect(groupBookingsForPlanning([])).toEqual([])
  })
})
