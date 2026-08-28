import { describe, it, expect, vi } from 'vitest'
import { computeCancellationTerms, storeCancellationTerms } from './cancellation-terms'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

const NOW = new Date('2026-08-21T12:00:00Z')
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

function makeSupabase({
  booking,
  listing,
  item,
}: {
  booking?: Record<string, unknown> | null
  listing?: Record<string, unknown> | null
  item?: Record<string, unknown> | null
} = {}) {
  const updates: { table: string; payload: Record<string, unknown> }[] = []
  const from = vi.fn((table: string) => {
    if (table === 'bookings') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: booking ?? null }) }) }) }
    }
    if (table === 'cruise_listings') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: listing ?? null }) }) }) }
    }
    if (table === 'fareharbor_items') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: item ?? null }) }) }) }
    }
    throw new Error(`unexpected table "${table}"`)
  })
  return { from, updates } as unknown as ReturnType<typeof createAdminClient> & { updates: typeof updates }
}

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    customer_name: 'Paul Kehoe',
    listing_id: null,
    listing_title: 'Private Hidden Gems Cruise',
    tour_item_id: null,
    start_time: hoursFromNow(51),
    status: 'confirmed',
    booking_source: 'website',
    stripe_amount: 31000, // €310.00
    booking_uuid: 'fh-uuid-1',
    external_id: null,
    booking_id: 'pi_abc123',
    ...overrides,
  }
}

describe('computeCancellationTerms — refund tiers (DEFAULT_TIERS: 48h/24h/0)', () => {
  it('falls in the full-refund tier more than 48h out', async () => {
    const supabase = makeSupabase({ booking: makeBooking({ start_time: hoursFromNow(51) }) })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.bookingFound).toBe(true)
    expect(terms.refundPercent).toBe(100)
    expect(terms.refundCents).toBe(31000)
    expect(terms.policySummary).toContain('full refund tier')
    expect(terms.policySummary).toContain('51h')
  })

  it('falls in the 50% tier between 24h and 48h out', async () => {
    const supabase = makeSupabase({ booking: makeBooking({ start_time: hoursFromNow(30) }) })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.refundPercent).toBe(50)
    expect(terms.refundCents).toBe(15500) // half of €310
    expect(terms.policySummary).toContain('50% refund tier')
  })

  it('falls in the no-refund tier within 24h', async () => {
    const supabase = makeSupabase({ booking: makeBooking({ start_time: hoursFromNow(6) }) })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.refundPercent).toBe(0)
    expect(terms.refundCents).toBe(0)
    expect(terms.policySummary).toContain('no-refund tier')
  })

  it('reports "already passed" once departure is in the past, never a negative refund', async () => {
    const supabase = makeSupabase({ booking: makeBooking({ start_time: hoursFromNow(-2) }) })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.refundPercent).toBe(0)
    expect(terms.refundCents).toBe(0)
    expect(terms.policySummary).toBe('Departure has already passed.')
  })

  it('rounds to the nearest cent rather than truncating', async () => {
    // 50% of €100.01 = 5000.5 cents → rounds to 5001 (Math.round), never
    // silently truncated to 5000 in the guest's favour or 5000 against.
    const supabase = makeSupabase({ booking: makeBooking({ start_time: hoursFromNow(30), stripe_amount: 10001 }) })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.refundCents).toBe(5001)
  })
})

describe('computeCancellationTerms — resolving the real policy, not always the default', () => {
  it('resolves tiers via listing_id → cruise_listings → fareharbor_items', async () => {
    // A custom policy putting the 100% cutoff at 24h instead of the default
    // 48h — 30h out lands in the FULL-refund tier here, but would be the
    // DEFAULT_TIERS' 50% tier (per the "50% tier" test above). Proves the
    // real per-item tiers were used, not a silent fall-through to the default.
    const supabase = makeSupabase({
      booking: makeBooking({ start_time: hoursFromNow(30), listing_id: 'listing-1' }),
      listing: { fareharbor_item_pk: 555 },
      item: { cancellation_tiers: [{ hours_before: 24, refund_percent: 100 }, { hours_before: 0, refund_percent: 0 }] },
    })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.refundPercent).toBe(100)
  })

  it('falls back to tour_item_id when there is no listing_id (OTA-imported bookings)', async () => {
    const supabase = makeSupabase({
      booking: makeBooking({ start_time: hoursFromNow(30), listing_id: null, tour_item_id: '234922' }),
      item: { cancellation_tiers: [{ hours_before: 24, refund_percent: 100 }, { hours_before: 0, refund_percent: 0 }] },
    })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.refundPercent).toBe(100)
  })

  it('falls back to DEFAULT_TIERS when neither listing_id nor tour_item_id is set', async () => {
    const supabase = makeSupabase({ booking: makeBooking({ start_time: hoursFromNow(30), listing_id: null, tour_item_id: null }) })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.refundPercent).toBe(50) // DEFAULT_TIERS' 24-48h tier
  })

  it('falls back to DEFAULT_TIERS when the listing has no fareharbor_item_pk', async () => {
    const supabase = makeSupabase({
      booking: makeBooking({ start_time: hoursFromNow(30), listing_id: 'listing-1' }),
      listing: { fareharbor_item_pk: null },
    })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.refundPercent).toBe(50)
  })
})

describe('computeCancellationTerms — the OTA and FareHarbor-reference guards', () => {
  it('flags an OTA booking so the caller never proposes cancelling it here', async () => {
    const supabase = makeSupabase({ booking: makeBooking({ booking_source: 'getyourguide' }) })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.isOtaBooking).toBe(true)
  })

  it('does not flag a direct website booking as OTA', async () => {
    const supabase = makeSupabase({ booking: makeBooking({ booking_source: 'website' }) })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.isOtaBooking).toBe(false)
  })

  it('canCancelInFareharbor is true when a real uuid exists', async () => {
    const supabase = makeSupabase({ booking: makeBooking({ booking_uuid: 'fh-uuid-1' }) })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.canCancelInFareharbor).toBe(true)
  })

  it('canCancelInFareharbor is FALSE when the booking exists in FareHarbor (external_id set) but has no uuid — the exact gap the cancel route guards against', async () => {
    const supabase = makeSupabase({
      booking: makeBooking({ booking_uuid: null, external_id: '371969124', booking_id: 'fh_371969124' }),
    })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.canCancelInFareharbor).toBe(false)
  })

  it('canCancelInFareharbor is true for a booking that was never in FareHarbor at all (admin-only)', async () => {
    const supabase = makeSupabase({
      booking: makeBooking({ booking_uuid: null, external_id: null, booking_id: 'pi_admin_only' }),
    })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.canCancelInFareharbor).toBe(true)
  })

  it('canCancelInFareharbor is true once already cancelled, regardless of uuid', async () => {
    const supabase = makeSupabase({
      booking: makeBooking({ status: 'cancelled', booking_uuid: null, external_id: '371969124' }),
    })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.canCancelInFareharbor).toBe(true)
    expect(terms.alreadyCancelled).toBe(true)
  })
})

describe('computeCancellationTerms — missing data', () => {
  it('returns bookingFound:false without querying anything else when the booking does not exist', async () => {
    const supabase = makeSupabase({ booking: null })
    const terms = await computeCancellationTerms('nope', supabase, NOW)

    expect(terms).toEqual({
      bookingId: 'nope',
      bookingFound: false,
      guestName: null,
      listingTitle: null,
      departureAt: null,
      hoursUntilDeparture: null,
      refundPercent: 0,
      amountPaidCents: 0,
      refundCents: 0,
      policySummary: 'Booking not found.',
      bookingSource: null,
      isOtaBooking: false,
      alreadyCancelled: false,
      canCancelInFareharbor: false,
    })
  })

  it('treats a null stripe_amount as nothing paid, not a crash', async () => {
    const supabase = makeSupabase({ booking: makeBooking({ stripe_amount: null }) })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.amountPaidCents).toBe(0)
    expect(terms.refundCents).toBe(0)
  })

  it('reports no departure time without crashing when start_time is null', async () => {
    const supabase = makeSupabase({ booking: makeBooking({ start_time: null }) })
    const terms = await computeCancellationTerms('bk-1', supabase, NOW)

    expect(terms.hoursUntilDeparture).toBeNull()
    expect(terms.refundPercent).toBe(0)
    expect(terms.policySummary).toContain('cannot place this in the cancellation window')
  })
})

describe('storeCancellationTerms', () => {
  it('merges cancellation_terms onto the proposal payload without dropping existing fields', async () => {
    const updateSpy = vi.fn((_payload: Record<string, unknown>) => {})
    const bookingSupabase = makeBooking({ start_time: hoursFromNow(51) })
    const from = vi.fn((table: string) => {
      if (table === 'bookings') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: bookingSupabase }) }) }) }
      }
      if (table === 'agent_proposals') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { payload: { reply: 'existing reply' } } }) }) }),
          update: (payload: Record<string, unknown>) => {
            updateSpy(payload)
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      throw new Error(`unexpected table "${table}"`)
    })
    vi.mocked(createAdminClient).mockReturnValue({ from } as never)

    const terms = await storeCancellationTerms('proposal-1', 'bk-1', NOW)

    expect(terms?.refundPercent).toBe(100)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    const [updatePayload] = updateSpy.mock.calls[0]
    const stored = updatePayload.payload as Record<string, unknown>
    // The existing reply survives the merge — this is an update, not a replace.
    expect(stored.reply).toBe('existing reply')
    expect((stored.cancellation_terms as { refundPercent: number }).refundPercent).toBe(100)
  })

  it('never throws — a DB failure returns null instead of breaking the shadow-drafter flow it follows', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('db unreachable')
    })

    await expect(storeCancellationTerms('proposal-1', 'bk-1')).resolves.toBeNull()
  })
})
