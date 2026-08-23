import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  draftCrossDayConsolidation: vi.fn(),
  validateBoatSwap: vi.fn().mockResolvedValue(null),
  draftBoatSwap: vi.fn(),
  // Defaults to "plenty of notice" — real wall-clock time keeps advancing
  // past hardcoded fixture dates, so this route's tests pin it explicitly
  // rather than relying on the fixture dates always being >18h in the real
  // future (see MIN_RESCHEDULE_NOTICE_HOURS, rulebook.ts). Individual tests
  // override the return value to exercise the cutoff itself.
  hasEnoughNotice: vi.fn().mockReturnValue(true),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/ghost/cross-day-move-drafter', () => ({ draftCrossDayConsolidation: h.draftCrossDayConsolidation }))
vi.mock('@/lib/ghost/boat-swap-drafter', () => ({ validateBoatSwap: h.validateBoatSwap, draftBoatSwap: h.draftBoatSwap }))
vi.mock('@/lib/ghost/rulebook', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ghost/rulebook')>()
  return { ...actual, hasEnoughNotice: h.hasEnoughNotice }
})
// Pinned so the route's server-computed "today → today+horizon" range is
// deterministic in tests, regardless of the real wall-clock date.
vi.mock('@/lib/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return {
    ...actual,
    amsterdamToday: (offsetDays = 0) => {
      const d = new Date('2026-08-23T00:00:00Z')
      d.setUTCDate(d.getUTCDate() + offsetDays)
      return d.toISOString().slice(0, 10)
    },
  }
})

import { GET } from './route'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

const BOAT = { name: 'Curaçao', max_capacity: 12 }

const PAIGE_BOOKING = {
  id: 'paige',
  booking_date: '2026-08-25',
  category: 'shared',
  customer_name: 'Paige Monacelli',
  customer_email: 'paige@example.com',
  customer_phone: null,
  extras_selected: [],
  listing_title: 'Shared Sunset Cruise',
  guest_count: 4,
  receipt_total: 15040,
  base_amount_cents: null,
  extras_amount_cents: null,
  fareharbor_availability_pk: 1001,
  customer_type_name: 'Adult (13+)',
  start_time: '2026-08-25T15:00:00Z',
  end_time: '2026-08-25T16:30:00Z',
}

const SOPHIE_BOOKING = {
  ...PAIGE_BOOKING,
  id: 'sophie',
  booking_date: '2026-08-26',
  customer_name: 'Sophie Russell',
  guest_count: 2,
  fareharbor_availability_pk: 1002,
  start_time: '2026-08-26T15:00:00Z',
  end_time: '2026-08-26T16:30:00Z',
}

const PAIGE_SHIFT = {
  id: 'tue-shift',
  date: '2026-08-25',
  start_at: '2026-08-25T14:15:00Z',
  end_at: '2026-08-25T17:30:00Z',
  status: 'open',
  staff_id: null,
  booking_id: null,
  fareharbor_availability_pk: 1001,
  boat_id: 'boat-1',
  staff: null,
  boats: BOAT,
}

const SOPHIE_SHIFT = {
  ...PAIGE_SHIFT,
  id: 'wed-shift',
  date: '2026-08-26',
  start_at: '2026-08-26T12:15:00Z',
  end_at: '2026-08-26T17:30:00Z',
  fareharbor_availability_pk: 1002,
}

/**
 * `proposalRows` seeds agent_proposals lookups (findOpenCrossDayProposal) —
 * keyed by booking id, returned only while `served` for that id is true, so
 * a test can assert "not found the first time, found after drafting".
 * `alreadyRecordedFindings` seeds the ops_events dedup check
 * (sameDayFindingAlreadyRecorded) — every dedup lookup in a single test run
 * shares this one flag, which is enough since no test here mixes an
 * already-recorded finding with a fresh one. `insertedOpsEvents` captures
 * every emitOpsEvent insert so a test can assert on the exact payload.
 */
function makeSupabase({
  shifts,
  bookings,
  existingProposalByBookingId = {},
  alreadyRecordedFindings = false,
  insertedOpsEvents = [] as Record<string, unknown>[],
  listingSlug = null as string | null,
  datesWithAnOpenAsk = [] as string[],
}: {
  shifts: unknown[]
  bookings: unknown[]
  existingProposalByBookingId?: Record<string, { id: string; payload: Record<string, unknown> }>
  alreadyRecordedFindings?: boolean
  insertedOpsEvents?: Record<string, unknown>[]
  /** Same-day boat-swap candidates look up cruise_listings.slug by listing_id — null means "not found" (falls back to a read-only finding). */
  listingSlug?: string | null
  /** Dates openMoveRequestExists (the cross-type sequential guard) should report as already claimed by some other ask. */
  datesWithAnOpenAsk?: string[]
}) {
  const from = vi.fn((table: string) => {
    if (table === 'ops_events') {
      const dedupBuilder = {
        eq: () => dedupBuilder,
        limit: () => dedupBuilder,
        maybeSingle: async () => ({ data: alreadyRecordedFindings ? { id: 'existing-event' } : null }),
      }
      return {
        select: () => dedupBuilder,
        insert: (row: Record<string, unknown>) => {
          insertedOpsEvents.push(row)
          return { error: null }
        },
      }
    }
    if (table === 'shifts') {
      return {
        select: () => ({
          gte: () => ({ lte: () => ({ in: () => ({ order: async () => ({ data: shifts, error: null }) }) }) }),
        }),
      }
    }
    if (table === 'bookings') {
      return {
        select: () => ({
          gte: () => ({ lte: () => ({ in: async () => ({ data: bookings, error: null }) }) }),
        }),
      }
    }
    if (table === 'cruise_listings') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: listingSlug ? { slug: listingSlug } : null }) }) }) }
    }
    if (table === 'agent_proposals') {
      // Self-referential chain supporting TWO distinct real query shapes on
      // this table: findOpenCrossDayProposal/findOpenBoatSwapProposal (3x eq
      // + in + order + limit + maybeSingle, keyed by booking) and
      // openMoveRequestExists (2x eq + in + limit, awaited directly — no
      // maybeSingle — keyed by date). Filters are captured across .eq() calls
      // so the `then` resolution can tell which query is actually running.
      const chain = (filters: Record<string, unknown> = {}): Record<string, unknown> => ({
        select: () => chain(filters),
        eq: (col: string, val: unknown) => chain({ ...filters, [col]: val }),
        in: () => chain(filters),
        order: () => chain(filters),
        limit: () => chain(filters),
        maybeSingle: async () => {
          // Any one bookingId match is enough for these tests — real
          // filtering already covered by the pure functions.
          const match = Object.values(existingProposalByBookingId)[0]
          return { data: match ?? null }
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => {
          const date = filters['payload->>target_date'] as string | undefined
          const claimed = !!date && datesWithAnOpenAsk.includes(date)
          resolve({ data: claimed ? [{ id: 'blocked-by-other-ask' }] : [], error: null })
        },
      })
      return { select: () => chain() }
    }
    throw new Error(`unexpected table: ${table}`)
  })
  return { from }
}

function makeReq(from: string, to: string) {
  return { nextUrl: { search: `?from=${from}&to=${to}` }, url: `http://x/api?from=${from}&to=${to}` } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks wipes call-tracking but not a previously-set mockReturnValue
  // — restore the "plenty of notice" default so one test's override of
  // hasEnoughNotice never leaks into the next.
  h.hasEnoughNotice.mockReturnValue(true)
})

describe('GET /api/admin/planning/optimizer', () => {
  it('always scans today → today+horizon, ignoring whatever range the caller passes', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ shifts: [], bookings: [] }) as never)

    // Deliberately nonsense/irrelevant params — a stale or past-week request
    // from the Planning page's currently-viewed dates must not change what
    // gets scanned (Beer, 2026-08-23: "always from the point of view of
    // today, not the past week").
    const res = await GET(makeReq('1999-01-01', '1999-01-02'))
    const body = await res.json()

    expect(body.data.from).toBe('2026-08-23')
    expect(body.data.to).toBe('2026-09-06')
  })

  it('finds the cross-day candidate and drafts a fresh ask when none exists yet', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabase({ shifts: [PAIGE_SHIFT, SOPHIE_SHIFT], bookings: [PAIGE_BOOKING, SOPHIE_BOOKING] }) as never,
    )
    h.draftCrossDayConsolidation.mockResolvedValue('drafted')

    const res = await GET(makeReq('2026-08-25', '2026-08-26'))
    const body = await res.json()

    expect(h.draftCrossDayConsolidation).toHaveBeenCalledTimes(1)
    const crossDay = body.data.items.find((i: { kind: string }) => i.kind === 'cross_day_consolidation')
    expect(crossDay).toBeTruthy()
    expect(crossDay.guestName).toBe('Sophie Russell')
    expect(crossDay.date).toBe('2026-08-26')
    expect(crossDay.toDate).toBe('2026-08-25')
    // Wed's shift, 5h15m, no captain assigned -> 0, not null (a candidate is
    // still worth showing even when unpriceable).
    expect(crossDay.estSavingCents).toBe(0)
  })

  it('reuses an existing open proposal instead of drafting (and calling Claude) again', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabase({
        shifts: [PAIGE_SHIFT, SOPHIE_SHIFT],
        bookings: [PAIGE_BOOKING, SOPHIE_BOOKING],
        existingProposalByBookingId: {
          sophie: { id: 'proposal-1', payload: { sms_text: 'existing sms {{link}}', email_subject: 'Hi', email_body: 'existing email {{link}}' } },
        },
      }) as never,
    )

    const res = await GET(makeReq('2026-08-25', '2026-08-26'))
    const body = await res.json()

    expect(h.draftCrossDayConsolidation).not.toHaveBeenCalled()
    const crossDay = body.data.items.find((i: { kind: string }) => i.kind === 'cross_day_consolidation')
    expect(crossDay.proposalId).toBe('proposal-1')
    expect(crossDay.smsText).toBe('existing sms {{link}}')
  })

  it("resolves a shift's full membership via shift_bookings, not just its primary booking_id — real bug, 2026-08-23: a Wednesday Curaçao shift's booking_id pointed at an unrelated PRIVATE cruise, silently hiding that Sophie's shared cruise was on the same shift", async () => {
    const privateBooking = {
      ...PAIGE_BOOKING,
      id: 'gurkan',
      category: 'private',
      customer_name: 'Gurkan Celik',
      guest_count: 10,
      fareharbor_availability_pk: 9999,
      customer_type_name: 'Curaçao - 1.5 Hours',
    }
    // The shift's OWN booking_id/fareharbor_availability_pk point at the
    // private booking (its primary departure) — shift_bookings is the only
    // place Sophie's shared cruise is visible on this shift at all.
    const wedShiftWithHiddenSecondBooking = {
      ...SOPHIE_SHIFT,
      booking_id: 'gurkan',
      fareharbor_availability_pk: null,
      shift_bookings: [{ booking_id: 'gurkan' }, { booking_id: 'sophie' }],
    }

    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabase({
        shifts: [PAIGE_SHIFT, wedShiftWithHiddenSecondBooking],
        bookings: [PAIGE_BOOKING, SOPHIE_BOOKING, privateBooking],
      }) as never,
    )

    const res = await GET(makeReq('2026-08-25', '2026-08-26'))
    const body = await res.json()

    // Wednesday's shift genuinely covers two departures (Gurkan's private
    // cruise stays on the water regardless of Sophie) — moving her away
    // would NOT free the whole shift, but it still SHRINKS it (Beer,
    // 2026-08-23: a shift shrinking is a real, valid saving even when it
    // isn't eliminated entirely), so this must still be offered. No captain
    // is assigned here (staff: null), so the shrink is unpriced (0), not a
    // reason to hide the candidate.
    const crossDay = body.data.items.find((i: { kind: string }) => i.kind === 'cross_day_consolidation')
    expect(crossDay).toBeTruthy()
    expect(crossDay.guestName).toBe('Sophie Russell')
    expect(crossDay.estSavingCents).toBe(0)
    expect(crossDay.summary).toContain('shortens the 2026-08-26 shift')
  })

  it('stays a read-only finding (no ask drafted) when the departure is inside the minimum-notice window', async () => {
    h.hasEnoughNotice.mockReturnValue(false)
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabase({ shifts: [PAIGE_SHIFT, SOPHIE_SHIFT], bookings: [PAIGE_BOOKING, SOPHIE_BOOKING] }) as never,
    )

    const res = await GET(makeReq('2026-08-25', '2026-08-26'))
    const body = await res.json()

    const crossDay = body.data.items.find((i: { kind: string }) => i.kind === 'cross_day_consolidation')
    expect(crossDay).toBeTruthy()
    expect(crossDay.proposalId).toBeUndefined()
    expect(crossDay.smsText).toBeUndefined()
    expect(h.draftCrossDayConsolidation).not.toHaveBeenCalled()
  })

  describe('sequential across move types (Beer, 2026-08-23: "max one open ask per day, any type")', () => {
    it('does not draft a cross-day ask when the FROM date already has some other open ask', async () => {
      vi.mocked(createAdminClient).mockReturnValue(
        makeSupabase({
          shifts: [PAIGE_SHIFT, SOPHIE_SHIFT],
          bookings: [PAIGE_BOOKING, SOPHIE_BOOKING],
          datesWithAnOpenAsk: ['2026-08-26'], // Sophie's own (fromDate)
        }) as never,
      )

      const res = await GET(makeReq('2026-08-25', '2026-08-26'))
      const body = await res.json()

      const crossDay = body.data.items.find((i: { kind: string }) => i.kind === 'cross_day_consolidation')
      expect(crossDay).toBeTruthy()
      expect(crossDay.proposalId).toBeUndefined()
      expect(h.draftCrossDayConsolidation).not.toHaveBeenCalled()
    })

    it('does not draft a cross-day ask when the TO date already has some other open ask', async () => {
      vi.mocked(createAdminClient).mockReturnValue(
        makeSupabase({
          shifts: [PAIGE_SHIFT, SOPHIE_SHIFT],
          bookings: [PAIGE_BOOKING, SOPHIE_BOOKING],
          datesWithAnOpenAsk: ['2026-08-25'], // Paige's day (toDate) — receiving the move
        }) as never,
      )

      const res = await GET(makeReq('2026-08-25', '2026-08-26'))
      const body = await res.json()

      const crossDay = body.data.items.find((i: { kind: string }) => i.kind === 'cross_day_consolidation')
      expect(crossDay).toBeTruthy()
      expect(crossDay.proposalId).toBeUndefined()
      expect(h.draftCrossDayConsolidation).not.toHaveBeenCalled()
    })
  })

  it('surfaces a same-day gap as its own item, separate from cross-day candidates', async () => {
    const morning = {
      id: 'morning-shift',
      date: '2026-08-27',
      start_at: '2026-08-27T09:00:00Z',
      end_at: '2026-08-27T11:00:00Z',
      status: 'assigned',
      staff_id: 'staff-1',
      booking_id: 'b-morning',
      fareharbor_availability_pk: null,
      boat_id: 'boat-1',
      staff: { name: 'Joris', hourly_rate_cents: 3000 },
      boats: BOAT,
    }
    const evening = {
      ...morning,
      id: 'evening-shift',
      start_at: '2026-08-27T14:00:00Z',
      end_at: '2026-08-27T16:00:00Z',
      booking_id: 'b-evening',
    }
    const bMorning = { ...PAIGE_BOOKING, id: 'b-morning', booking_date: '2026-08-27', category: 'private', fareharbor_availability_pk: null }
    const bEvening = { ...PAIGE_BOOKING, id: 'b-evening', booking_date: '2026-08-27', category: 'private', fareharbor_availability_pk: null }

    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ shifts: [morning, evening], bookings: [bMorning, bEvening] }) as never)

    const res = await GET(makeReq('2026-08-27', '2026-08-27'))
    const body = await res.json()

    const gap = body.data.items.find((i: { kind: string }) => i.kind === 'same_day_gap')
    expect(gap).toBeTruthy()
    expect(gap.date).toBe('2026-08-27')
    // 3h gap (11:00-14:00) at €30/hr = €90 = 9000 cents.
    expect(gap.estSavingCents).toBe(9000)
    expect(h.draftCrossDayConsolidation).not.toHaveBeenCalled()
  })

  describe('same-day boat swap (Beer, 2026-08-23: "private cruises can definitely swap Diana for Curaçao")', () => {
    const DIANA_BOAT = { name: 'Diana', max_capacity: 8 }
    const privateDianaBooking = {
      ...PAIGE_BOOKING,
      id: 'gurkan-private',
      booking_date: '2026-08-28',
      category: 'private',
      customer_name: 'Gurkan Celik',
      listing_id: 'listing-diana-private',
      guest_count: 4,
      fareharbor_availability_pk: 4001,
      start_time: '2026-08-28T09:00:00Z',
      end_time: '2026-08-28T10:30:00Z',
    }
    const dianaShift = {
      id: 'diana-shift',
      date: '2026-08-28',
      start_at: '2026-08-28T08:15:00Z',
      end_at: '2026-08-28T11:30:00Z',
      status: 'assigned',
      staff_id: 'staff-diana',
      booking_id: 'gurkan-private',
      fareharbor_availability_pk: 4001,
      boat_id: 'boat-diana',
      staff: { name: 'Jip', hourly_rate_cents: 3500 },
      boats: DIANA_BOAT,
    }
    const otherCuracaoBooking = {
      ...PAIGE_BOOKING,
      id: 'other-curacao',
      booking_date: '2026-08-28',
      fareharbor_availability_pk: 4002,
      start_time: '2026-08-28T14:00:00Z',
      end_time: '2026-08-28T15:30:00Z',
    }
    const curacaoShift = {
      id: 'curacao-shift',
      date: '2026-08-28',
      start_at: '2026-08-28T13:15:00Z',
      end_at: '2026-08-28T16:30:00Z',
      status: 'assigned',
      staff_id: 'staff-curacao',
      booking_id: 'other-curacao',
      fareharbor_availability_pk: 4002,
      boat_id: 'boat-curacao',
      staff: { name: 'Femke', hourly_rate_cents: 4000 },
      boats: BOAT,
    }

    it('dry-run validates and drafts a real ask when a private cruise fits cleanly onto the other boat', async () => {
      h.validateBoatSwap.mockResolvedValue({ slot: { availPk: 1, customerTypeRatePk: 2, optionName: 'Private' }, verdict: { is_bookable: true } })
      h.draftBoatSwap.mockResolvedValue('drafted')
      vi.mocked(createAdminClient).mockReturnValue(
        makeSupabase({
          shifts: [dianaShift, curacaoShift],
          bookings: [privateDianaBooking, otherCuracaoBooking],
          listingSlug: 'private-hidden-gems-cruise',
        }) as never,
      )

      const res = await GET(makeReq('2026-08-28', '2026-08-28'))
      const body = await res.json()

      const swap = body.data.items.find((i: { kind: string; boat: string }) => i.kind === 'same_day_merge' && i.boat === 'Diana')
      expect(swap).toBeTruthy()
      expect(swap.date).toBe('2026-08-28')
      // 3h15m (08:15-11:30) at €35/h = €113.75 = 11375 cents.
      expect(swap.estSavingCents).toBe(11375)

      // The dry-run ran against the REAL resolved booking, not a guess.
      expect(h.validateBoatSwap).toHaveBeenCalledWith(
        expect.objectContaining({ fromBoat: 'Diana', toBoat: 'Curaçao' }),
        expect.objectContaining({ id: 'gurkan-private', category: 'private', customerName: 'Gurkan Celik' }),
        'private-hidden-gems-cruise',
      )
      expect(h.draftBoatSwap).toHaveBeenCalled()
    })

    it('stays a read-only finding (no ask drafted) when FareHarbor has no matching slot on the other boat', async () => {
      h.validateBoatSwap.mockResolvedValue(null)
      vi.mocked(createAdminClient).mockReturnValue(
        makeSupabase({
          shifts: [dianaShift, curacaoShift],
          bookings: [privateDianaBooking, otherCuracaoBooking],
          listingSlug: 'private-hidden-gems-cruise',
        }) as never,
      )

      const res = await GET(makeReq('2026-08-28', '2026-08-28'))
      const body = await res.json()

      const swap = body.data.items.find((i: { kind: string; boat: string }) => i.kind === 'same_day_merge' && i.boat === 'Diana')
      expect(swap).toBeTruthy()
      expect(swap.proposalId).toBeUndefined()
      expect(swap.smsText).toBeUndefined()
      expect(h.draftBoatSwap).not.toHaveBeenCalled()
    })

    it('stays a read-only finding when the booking has no listing_id to validate against', async () => {
      h.validateBoatSwap.mockResolvedValue({ slot: { availPk: 1, customerTypeRatePk: 2, optionName: 'Private' }, verdict: { is_bookable: true } })
      vi.mocked(createAdminClient).mockReturnValue(
        makeSupabase({
          shifts: [dianaShift, curacaoShift],
          bookings: [{ ...privateDianaBooking, listing_id: null }, otherCuracaoBooking],
        }) as never,
      )

      const res = await GET(makeReq('2026-08-28', '2026-08-28'))
      const body = await res.json()

      const swap = body.data.items.find((i: { kind: string; boat: string }) => i.kind === 'same_day_merge' && i.boat === 'Diana')
      expect(swap).toBeTruthy()
      expect(swap.proposalId).toBeUndefined()
      expect(h.validateBoatSwap).not.toHaveBeenCalled()
    })

    it('stays a read-only finding (no ask, no FH dry-run) when the departure is inside the minimum-notice window', async () => {
      h.hasEnoughNotice.mockReturnValue(false)
      vi.mocked(createAdminClient).mockReturnValue(
        makeSupabase({
          shifts: [dianaShift, curacaoShift],
          bookings: [privateDianaBooking, otherCuracaoBooking],
          listingSlug: 'private-hidden-gems-cruise',
        }) as never,
      )

      const res = await GET(makeReq('2026-08-28', '2026-08-28'))
      const body = await res.json()

      const swap = body.data.items.find((i: { kind: string; boat: string }) => i.kind === 'same_day_merge' && i.boat === 'Diana')
      expect(swap).toBeTruthy()
      expect(swap.proposalId).toBeUndefined()
      expect(h.validateBoatSwap).not.toHaveBeenCalled()
      expect(h.draftBoatSwap).not.toHaveBeenCalled()
    })

    it('stays a read-only finding when that day already has some other open ask (Beer, 2026-08-23: "max one open ask per day, any type")', async () => {
      vi.mocked(createAdminClient).mockReturnValue(
        makeSupabase({
          shifts: [dianaShift, curacaoShift],
          bookings: [privateDianaBooking, otherCuracaoBooking],
          listingSlug: 'private-hidden-gems-cruise',
          datesWithAnOpenAsk: ['2026-08-28'],
        }) as never,
      )

      const res = await GET(makeReq('2026-08-28', '2026-08-28'))
      const body = await res.json()

      const swap = body.data.items.find((i: { kind: string; boat: string }) => i.kind === 'same_day_merge' && i.boat === 'Diana')
      expect(swap).toBeTruthy()
      expect(swap.proposalId).toBeUndefined()
      expect(h.validateBoatSwap).not.toHaveBeenCalled()
      expect(h.draftBoatSwap).not.toHaveBeenCalled()
    })
  })

  describe('persisting same-day findings (Beer, 2026-08-23: "whatever it finds, it should store that information")', () => {
    const morning = {
      id: 'morning-shift',
      date: '2026-08-27',
      start_at: '2026-08-27T09:00:00Z',
      end_at: '2026-08-27T11:00:00Z',
      status: 'assigned',
      staff_id: 'staff-1',
      booking_id: 'b-morning',
      fareharbor_availability_pk: null,
      boat_id: 'boat-1',
      staff: { name: 'Joris', hourly_rate_cents: 3000 },
      boats: BOAT,
    }
    const evening = {
      ...morning,
      id: 'evening-shift',
      start_at: '2026-08-27T14:00:00Z',
      end_at: '2026-08-27T16:00:00Z',
      booking_id: 'b-evening',
    }
    const bMorning = { ...PAIGE_BOOKING, id: 'b-morning', booking_date: '2026-08-27', category: 'private', fareharbor_availability_pk: null }
    const bEvening = { ...PAIGE_BOOKING, id: 'b-evening', booking_date: '2026-08-27', category: 'private', fareharbor_availability_pk: null }

    it('records a fresh same-day gap as a recommendation_created ops_event', async () => {
      const insertedOpsEvents: Record<string, unknown>[] = []
      vi.mocked(createAdminClient).mockReturnValue(
        makeSupabase({ shifts: [morning, evening], bookings: [bMorning, bEvening], insertedOpsEvents }) as never,
      )

      await GET(makeReq('2026-08-27', '2026-08-27'))

      expect(insertedOpsEvents).toHaveLength(1)
      expect(insertedOpsEvents[0]).toMatchObject({
        event_type: 'recommendation_created',
        actor_type: 'system', // no AI judgment here — plain math, not an agent decision
        source: 'admin/planning/optimizer',
        payload: expect.objectContaining({ finding_type: 'same_day_gap', date: '2026-08-27', boat: 'Curaçao' }),
      })
    })

    it('does not re-record a finding that was already recorded on a previous scan', async () => {
      const insertedOpsEvents: Record<string, unknown>[] = []
      vi.mocked(createAdminClient).mockReturnValue(
        makeSupabase({
          shifts: [morning, evening],
          bookings: [bMorning, bEvening],
          alreadyRecordedFindings: true,
          insertedOpsEvents,
        }) as never,
      )

      await GET(makeReq('2026-08-27', '2026-08-27'))

      expect(insertedOpsEvents).toHaveLength(0)
    })
  })
})
