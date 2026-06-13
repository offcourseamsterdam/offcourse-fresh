import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/search/fetch-search-results', () => ({ fetchSearchResults: vi.fn() }))

import { prepareInboxBookingBody } from './book-from-proposal'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import type { SearchResult } from '@/types'

function results(): SearchResult[] {
  return [
    {
      listing: { id: 'listing-1', slug: 'private-hidden-gems-cruise', title: 'Private Cruise', category: 'private' } as SearchResult['listing'],
      availableSlots: [
        {
          pk: 9001,
          startTime: '5pm',
          startAt: '2026-06-20T17:00:00Z',
          endAt: '2026-06-20T19:00:00Z',
          headline: '5pm',
          capacity: 1,
          customerTypes: [
            { pk: 7001, totalCapacity: 1, customerTypePk: 1, name: 'Diana 2h', boatId: 'diana', minimumParty: 1, maximumParty: 8, priceCents: 40000, durationMinutes: 120 },
          ],
        },
      ],
      date: '2026-06-20',
      guests: 4,
    },
  ]
}

const CONTACT = { name: 'Anna', email: 'anna@example.de', phone_e164: '+31612345678' }
const BOOKING = { listing_slug: 'private-hidden-gems-cruise', date: '2026-06-20', time: '5pm', guests: 4, option: 'Diana 2h' }

describe('prepareInboxBookingBody', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds the exact money-path body from a resolved slot', async () => {
    vi.mocked(fetchSearchResults).mockResolvedValue(results() as never)
    const r = await prepareInboxBookingBody(BOOKING, CONTACT)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.body).toMatchObject({
      availPk: 9001,
      customerTypeRatePk: 7001,
      guestCount: 4,
      category: 'private',
      contact: { name: 'Anna', email: 'anna@example.de', phone: '+31612345678' },
      listingId: 'listing-1',
      bookingSource: 'complimentary',
      startAt: '2026-06-20T17:00:00Z',
    })
  })

  it('refuses without full contact details (no real booking on a placeholder)', async () => {
    const r = await prepareInboxBookingBody(BOOKING, { name: 'Anna', email: 'anna@example.de', phone_e164: null })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('phone')
    expect(fetchSearchResults).not.toHaveBeenCalled() // bail before any network
  })

  it('refuses a proposal missing slug/date/time', async () => {
    const r = await prepareInboxBookingBody({ guests: 4 }, CONTACT)
    expect(r.ok).toBe(false)
    expect(fetchSearchResults).not.toHaveBeenCalled()
  })

  it('refuses (abstains) when the slot no longer resolves against live availability', async () => {
    vi.mocked(fetchSearchResults).mockResolvedValue(results() as never)
    const r = await prepareInboxBookingBody({ ...BOOKING, time: '3am' }, CONTACT)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('no longer bookable')
  })

  it('never sets a money-path source that would charge Stripe (internal/complimentary only)', async () => {
    vi.mocked(fetchSearchResults).mockResolvedValue(results() as never)
    const r = await prepareInboxBookingBody(BOOKING, CONTACT)
    if (!r.ok) throw new Error('expected ok')
    expect(r.body.bookingSource).toBe('complimentary')
  })
})
