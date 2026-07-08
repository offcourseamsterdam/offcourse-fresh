import { describe, it, expect } from 'vitest'
import { groupBookingsForPlanning, extractBoatName, resolveBoatForGroup, splitGroupsByBoat, boatAccentClasses } from './planning-groups'
import type { AdminBooking } from './types'
import type { SharedCapacityResult } from './shared-capacity'

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
    fareharbor_availability_pk: null,
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

describe('extractBoatName', () => {
  it('parses the boat from a private customer type name', () => {
    expect(extractBoatName('Diana - 2 Hours')).toBe('Diana')
    expect(extractBoatName('Curaçao - 3 Hours')).toBe('Curaçao')
  })

  it('matches the ASCII spelling "Curacao" too (no cedilla)', () => {
    expect(extractBoatName('Curacao - 1.5 Hours')).toBe('Curaçao')
  })

  it('is case-insensitive', () => {
    expect(extractBoatName('DIANA - 2 HOURS')).toBe('Diana')
  })

  it('returns null for a shared customer type (no boat data available)', () => {
    expect(extractBoatName('Adult (13+)')).toBeNull()
    expect(extractBoatName('Child (0-12)')).toBeNull()
  })

  it('returns null for null/undefined input', () => {
    expect(extractBoatName(null)).toBeNull()
    expect(extractBoatName(undefined)).toBeNull()
  })
})

describe('resolveBoatForGroup', () => {
  function makeGroup(overrides: Partial<AdminBooking>): ReturnType<typeof groupBookingsForPlanning>[number] {
    const booking = makeBooking(overrides)
    return { key: booking.id, bookings: [booking], totalGuestCount: booking.guest_count ?? 0 }
  }

  it('prefers the name-based signal for private cruises, ignoring sharedCapacity entirely', () => {
    const group = makeGroup({ customer_type_name: 'Diana - 2 Hours', category: 'private' })
    expect(resolveBoatForGroup(group)).toBe('Diana')
  })

  it('falls back to the live capacity guess for a shared cruise', () => {
    const group = makeGroup({ customer_type_name: 'Adult (13+)', category: 'shared', fareharbor_availability_pk: 555 })
    const sharedCapacity: Record<number, SharedCapacityResult> = { 555: { spotsLeft: 8, boatGuess: 'Curaçao' } }
    expect(resolveBoatForGroup(group, sharedCapacity)).toBe('Curaçao')
  })

  it('returns null for a shared cruise when capacity data has not loaded yet', () => {
    const group = makeGroup({ customer_type_name: 'Adult (13+)', category: 'shared', fareharbor_availability_pk: 555 })
    expect(resolveBoatForGroup(group, undefined)).toBeNull()
  })

  it('returns null when the capacity guess itself came back null (no clean boat match)', () => {
    const group = makeGroup({ customer_type_name: 'Adult (13+)', category: 'shared', fareharbor_availability_pk: 555 })
    const sharedCapacity: Record<number, SharedCapacityResult> = { 555: { spotsLeft: 6, boatGuess: null } }
    expect(resolveBoatForGroup(group, sharedCapacity)).toBeNull()
  })
})

describe('splitGroupsByBoat', () => {
  function makeGroup(customerTypeName: string): ReturnType<typeof groupBookingsForPlanning>[number] {
    const booking = makeBooking({ customer_type_name: customerTypeName })
    return { key: booking.id, bookings: [booking], totalGuestCount: booking.guest_count ?? 0 }
  }

  it('resolves a shared departure into its real boat column once capacity data identifies it', () => {
    const shared = makeBooking({ customer_type_name: 'Adult (13+)', category: 'shared', fareharbor_availability_pk: 555 })
    const sharedGroup = { key: shared.id, bookings: [shared], totalGuestCount: shared.guest_count ?? 0 }
    const curacaoPrivate = makeGroup('Curaçao - 2 Hours')
    const sharedCapacity: Record<number, SharedCapacityResult> = { 555: { spotsLeft: 8, boatGuess: 'Curaçao' } }

    const columns = splitGroupsByBoat([sharedGroup, curacaoPrivate], sharedCapacity)

    expect(columns).toHaveLength(1)
    expect(columns[0].boat).toBe('Curaçao')
    expect(columns[0].groups).toHaveLength(2)
  })

  it('splits Diana and Curaçao departures into separate, alphabetically-sorted columns', () => {
    const diana = makeGroup('Diana - 2 Hours')
    const curacao = makeGroup('Curaçao - 3 Hours')

    const columns = splitGroupsByBoat([diana, curacao])

    expect(columns.map(c => c.boat)).toEqual(['Curaçao', 'Diana'])
    expect(columns[0].groups).toEqual([curacao])
    expect(columns[1].groups).toEqual([diana])
  })

  it('buckets shared (undetermined-boat) departures under "Other", sorted last', () => {
    const diana = makeGroup('Diana - 2 Hours')
    const shared = makeGroup('Adult (13+)')

    const columns = splitGroupsByBoat([shared, diana])

    expect(columns.map(c => c.boat)).toEqual(['Diana', 'Other'])
  })

  it('returns a single column when every group is on the same boat', () => {
    const a = makeGroup('Diana - 1.5 Hours')
    const b = makeGroup('Diana - 2 Hours')

    const columns = splitGroupsByBoat([a, b])

    expect(columns).toHaveLength(1)
    expect(columns[0].boat).toBe('Diana')
    expect(columns[0].groups).toHaveLength(2)
  })

  it('returns an empty array for no groups', () => {
    expect(splitGroupsByBoat([])).toEqual([])
  })
})

describe('boatAccentClasses', () => {
  it('gives Diana and Curaçao distinct, non-neutral accent colors', () => {
    const diana = boatAccentClasses('Diana')
    const curacao = boatAccentClasses('Curaçao')
    expect(diana.dot).not.toBe(curacao.dot)
    expect(diana.dot).not.toContain('zinc')
    expect(curacao.dot).not.toContain('zinc')
  })

  it('gives "Other" a neutral zinc accent', () => {
    expect(boatAccentClasses('Other').dot).toContain('zinc')
  })

  it('is consistent for the same boat every time', () => {
    expect(boatAccentClasses('Diana')).toEqual(boatAccentClasses('Diana'))
  })
})
