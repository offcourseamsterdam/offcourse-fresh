import { describe, it, expect } from 'vitest'
import { matchesBookingSearch, type SearchableBooking } from './booking-search'

const BOOKING: SearchableBooking = {
  customer_name: 'ARTEM KHOMENKO',
  customer_email: 'artem.h.23@gmail.com',
  customer_phone: '+31 6 12345678',
  listing_title: 'Private Hidden Gems Cruise',
  tour_item_name: 'Hidden Gems Private Boat Tour',
  booking_uuid: 'd5090d2b-52cb-4d78-8d68-383cb330d492',
  stripe_payment_intent_id: 'pi_3TqDDhGh1qCF71Ta0maOwSGW',
}

describe('matchesBookingSearch', () => {
  it('matches a lowercase substring of the guest name against a mixed-case name', () => {
    expect(matchesBookingSearch(BOOKING, 'artem')).toBe(true)
  })

  it('matches case-insensitively regardless of query casing', () => {
    expect(matchesBookingSearch(BOOKING, 'ArTeM')).toBe(true)
  })

  it('matches on email', () => {
    expect(matchesBookingSearch(BOOKING, 'artem.h.23')).toBe(true)
  })

  it('matches on cruise/listing title', () => {
    expect(matchesBookingSearch(BOOKING, 'hidden gems')).toBe(true)
  })

  it('matches on FareHarbor booking uuid', () => {
    expect(matchesBookingSearch(BOOKING, 'd5090d2b')).toBe(true)
  })

  it('matches on Stripe payment intent id', () => {
    expect(matchesBookingSearch(BOOKING, 'pi_3TqDDhGh1qCF71Ta0maOwSGW')).toBe(true)
  })

  it('does not match an unrelated query', () => {
    expect(matchesBookingSearch(BOOKING, 'zzz-no-match')).toBe(false)
  })

  it('treats an empty or whitespace-only query as matching everything', () => {
    expect(matchesBookingSearch(BOOKING, '')).toBe(true)
    expect(matchesBookingSearch(BOOKING, '   ')).toBe(true)
  })

  it('does not throw when fields are null', () => {
    const sparse: SearchableBooking = {
      customer_name: null, customer_email: null, customer_phone: null,
      listing_title: null, tour_item_name: null, booking_uuid: null,
      stripe_payment_intent_id: null,
    }
    expect(matchesBookingSearch(sparse, 'anything')).toBe(false)
    expect(matchesBookingSearch(sparse, '')).toBe(true)
  })
})
