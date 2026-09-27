import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveCheckoutItems } from './resolve-checkout-items'
import { encodeItemId } from './item-id'

const h = vi.hoisted(() => ({
  getListingBySlug: vi.fn(),
  getFilteredAvailabilityBySlug: vi.fn(),
}))

vi.mock('@/lib/cruise/get-cruise-page-data', () => ({ getListingBySlug: h.getListingBySlug }))
vi.mock('@/lib/fareharbor/availability', () => ({ getFilteredAvailabilityBySlug: h.getFilteredAvailabilityBySlug }))

const SHARED_LISTING = { id: 'listing-1', slug: 'hidden-gems-shared', category: 'shared', title: 'Hidden Gems Cruise' }
const PRIVATE_LISTING = { id: 'listing-2', slug: 'book-curacao-boat-tour-amsterdam', category: 'private', title: 'Book the Curaçao', max_guests: 12 }

// Real FareHarbor slots use a human display string for startTime (e.g.
// "11am"), never a parseable "HH:MM" — these fixtures deliberately mirror
// that so a regression back to matching on a fake "HH:MM" format would fail.
const SHARED_SLOT = {
  pk: 999,
  startTime: '2pm',
  startAt: '2026-07-04T14:00:00+02:00',
  endAt: '2026-07-04T15:30:00+02:00',
  customerTypes: [
    { pk: 111, customerTypePk: 1, name: 'Adult (13+)', boatId: 'curacao', minimumParty: 1, maximumParty: 12, priceCents: 3500, durationMinutes: 90 },
    { pk: 222, customerTypePk: 2, name: 'Child (0-12)', boatId: 'curacao', minimumParty: 0, maximumParty: 12, priceCents: 2000, durationMinutes: 90 },
  ],
}

const PRIVATE_SLOT = {
  pk: 888,
  startTime: '2pm',
  startAt: '2026-07-04T14:00:00+02:00',
  endAt: '2026-07-04T15:30:00+02:00',
  customerTypes: [
    { pk: 333, customerTypePk: 5, name: 'Diana - 1.5 Hours', boatId: 'diana', minimumParty: 1, maximumParty: 8, priceCents: 31000, durationMinutes: 90 },
  ],
}

describe('resolveCheckoutItems', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an empty items array', async () => {
    const result = await resolveCheckoutItems([])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.messages[0].code).toBe('items_required')
  })

  it('rejects a non-positive or non-integer quantity', async () => {
    const id = encodeItemId({ slug: 'x', date: '2026-07-04', availPk: 999, customerTypeRatePk: 1 })
    const result = await resolveCheckoutItems([{ id, quantity: 0 }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.messages[0].code).toBe('invalid_quantity')
  })

  it('rejects a malformed item id', async () => {
    const result = await resolveCheckoutItems([{ id: 'garbage', quantity: 1 }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.messages[0].code).toBe('invalid_item')
  })

  it('rejects items spanning different cruises/dates/availabilities', async () => {
    const a = encodeItemId({ slug: 'x', date: '2026-07-04', availPk: 999, customerTypeRatePk: 1 })
    const b = encodeItemId({ slug: 'x', date: '2026-07-04', availPk: 888, customerTypeRatePk: 1 })
    const result = await resolveCheckoutItems([{ id: a, quantity: 1 }, { id: b, quantity: 1 }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.messages[0].code).toBe('mixed_selection')
  })

  it('rejects an unknown listing', async () => {
    h.getListingBySlug.mockResolvedValue(null)
    const id = encodeItemId({ slug: 'missing', date: '2026-07-04', availPk: 999, customerTypeRatePk: 1 })
    const result = await resolveCheckoutItems([{ id, quantity: 1 }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.messages[0].code).toBe('listing_not_found')
  })

  describe('shared cruise pricing', () => {
    beforeEach(() => {
      h.getListingBySlug.mockResolvedValue(SHARED_LISTING)
      h.getFilteredAvailabilityBySlug.mockResolvedValue({ slots: [SHARED_SLOT], reasonCode: null })
    })

    it('prices each ticket type per-person and sums guest count across items', async () => {
      const adult = encodeItemId({ slug: 'hidden-gems-shared', date: '2026-07-04', availPk: 999, customerTypeRatePk: 111 })
      const child = encodeItemId({ slug: 'hidden-gems-shared', date: '2026-07-04', availPk: 999, customerTypeRatePk: 222 })
      const result = await resolveCheckoutItems([{ id: adult, quantity: 2 }, { id: child, quantity: 1 }])

      expect(result.ok).toBe(true)
      if (result.ok) {
        // 2 adults × €35 + 1 child × €20 = €90 subtotal = 9000 cents
        expect(result.checkout.subtotalCents).toBe(9000)
        // + city tax: 3 guests × €2.60 = 780 cents
        expect(result.checkout.cityTaxCents).toBe(780)
        expect(result.checkout.totalCents).toBe(9780)
        expect(result.checkout.guestCount).toBe(3)
        expect(result.checkout.isPrivate).toBe(false)
        expect(result.checkout.customerTypeRates).toEqual([{ pk: 111, count: 2 }, { pk: 222, count: 1 }])
        expect(result.checkout.availPk).toBe(999)
      }
      // guestCount (3) is what gets passed to the live availability check
      expect(h.getFilteredAvailabilityBySlug).toHaveBeenCalledWith('hidden-gems-shared', '2026-07-04', 3)
    })

    it('rejects a rate pk not present on the resolved slot', async () => {
      const id = encodeItemId({ slug: 'hidden-gems-shared', date: '2026-07-04', availPk: 999, customerTypeRatePk: 999999 })
      const result = await resolveCheckoutItems([{ id, quantity: 1 }])
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.messages[0].code).toBe('rate_not_available')
    })

    it('enforces the rate\'s min/max party size', async () => {
      const id = encodeItemId({ slug: 'hidden-gems-shared', date: '2026-07-04', availPk: 999, customerTypeRatePk: 111 })
      const result = await resolveCheckoutItems([{ id, quantity: 20 }])
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.messages[0].code).toBe('party_size')
    })

    it('reports not_available when no slot matches the requested availPk', async () => {
      const id = encodeItemId({ slug: 'hidden-gems-shared', date: '2026-07-04', availPk: 424242, customerTypeRatePk: 111 })
      const result = await resolveCheckoutItems([{ id, quantity: 1 }])
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.messages[0].code).toBe('not_available')
    })
  })

  describe('private charter pricing', () => {
    beforeEach(() => {
      h.getListingBySlug.mockResolvedValue(PRIVATE_LISTING)
      h.getFilteredAvailabilityBySlug.mockResolvedValue({ slots: [PRIVATE_SLOT], reasonCode: null })
    })

    it('charges the flat boat rate regardless of guest count, not price × guests', async () => {
      const id = encodeItemId({ slug: 'book-curacao-boat-tour-amsterdam', date: '2026-07-04', availPk: 888, customerTypeRatePk: 333 })
      const result = await resolveCheckoutItems([{ id, quantity: 6 }])

      expect(result.ok).toBe(true)
      if (result.ok) {
        // Flat €310, NOT €310 × 6 — this is the bug this module exists to prevent.
        expect(result.checkout.subtotalCents).toBe(31000)
        // City tax is still per-guest even though the boat rate itself is flat: 6 × €2.60 = 1560
        expect(result.checkout.cityTaxCents).toBe(1560)
        expect(result.checkout.totalCents).toBe(32560)
        expect(result.checkout.guestCount).toBe(6)
        expect(result.checkout.isPrivate).toBe(true)
      }
      // guestCount used for availability is the quantity itself (6), not a sum
      expect(h.getFilteredAvailabilityBySlug).toHaveBeenCalledWith('book-curacao-boat-tour-amsterdam', '2026-07-04', 6)
    })

    it('ignores the rate\'s own minimumParty/maximumParty (structurally 1/1 for private) and checks listing.max_guests instead', async () => {
      // Regression test: real FareHarbor data reports minimumParty=1,
      // maximumParty=1 on a private rate regardless of true boat capacity —
      // that field bounds "how many of this line item" (always one boat),
      // not guest count. Caught via live verification, not a mock.
      const id = encodeItemId({ slug: 'book-curacao-boat-tour-amsterdam', date: '2026-07-04', availPk: 888, customerTypeRatePk: 333 })
      const result = await resolveCheckoutItems([{ id, quantity: 6 }])
      expect(result.ok).toBe(true)
    })

    it('rejects a private guest count above the listing\'s max_guests', async () => {
      const id = encodeItemId({ slug: 'book-curacao-boat-tour-amsterdam', date: '2026-07-04', availPk: 888, customerTypeRatePk: 333 })
      const result = await resolveCheckoutItems([{ id, quantity: 99 }])
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.messages[0].code).toBe('party_size')
    })

    it('rejects more than one item for a private charter', async () => {
      const id1 = encodeItemId({ slug: 'book-curacao-boat-tour-amsterdam', date: '2026-07-04', availPk: 888, customerTypeRatePk: 333 })
      const id2 = encodeItemId({ slug: 'book-curacao-boat-tour-amsterdam', date: '2026-07-04', availPk: 888, customerTypeRatePk: 333 })
      const result = await resolveCheckoutItems([{ id: id1, quantity: 2 }, { id: id2, quantity: 2 }])
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.messages[0].code).toBe('mixed_selection')
    })
  })
})
