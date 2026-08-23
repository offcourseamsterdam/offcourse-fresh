import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  draftCrossDayConsolidation: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/ghost/cross-day-move-drafter', () => ({ draftCrossDayConsolidation: h.draftCrossDayConsolidation }))

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
 */
function makeSupabase({
  shifts,
  bookings,
  existingProposalByBookingId = {},
}: {
  shifts: unknown[]
  bookings: unknown[]
  existingProposalByBookingId?: Record<string, { id: string; payload: Record<string, unknown> }>
}) {
  const from = vi.fn((table: string) => {
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
    if (table === 'agent_proposals') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => {
                        // Any one bookingId match is enough for these tests —
                        // real filtering already covered by the pure functions.
                        const match = Object.values(existingProposalByBookingId)[0]
                        return { data: match ?? null }
                      },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }
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
})

describe('GET /api/admin/planning/optimizer', () => {
  it('requires from and to query params', async () => {
    const res = await GET(makeReq('', '2026-08-30'))
    expect(res.status).toBe(400)
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
})
