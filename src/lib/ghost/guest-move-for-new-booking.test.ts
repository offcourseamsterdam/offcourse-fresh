import { describe, it, expect, vi, beforeEach } from 'vitest'

// vitest hoists vi.mock above the imports below.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ meteredMessage: vi.fn() }))
vi.mock('@/lib/scheduling/sync-shifts', () => ({ syncShiftsForRange: vi.fn() }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/search/fetch-search-results', () => ({ fetchSearchResults: vi.fn() }))
const fhValidate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/fareharbor/client', () => ({ getFareHarborClient: () => ({ validateBooking: fhValidate }) }))

import { draftGuestMoveForNewBooking } from './guest-move-drafter'
import { createAdminClient } from '@/lib/supabase/admin'
import { meteredMessage } from '@/lib/ai/usage'
import { syncShiftsForRange } from '@/lib/scheduling/sync-shifts'
import { emitOpsEvent } from '@/lib/ops/events'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'

const DATE = '2026-07-05'

/**
 * The new-booking trigger (Beer 2026-07-04: "every time a new booking comes
 * in") — its job is orchestration (sync this date's shifts first, respect
 * the sequential invariant, skip-first when there's nothing to see), not the
 * candidate math itself (that's selectMoveCandidate, tested separately).
 */
function makeSupabase(queues: Record<string, Array<{ data: unknown }>> = {}) {
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = vi.fn((table: string): any => {
    const pull = () => {
      const q = queues[table]
      return q && q.length ? q.shift()! : { data: null, error: null }
    }
    const readBuilder: Record<string, unknown> = {
      select: () => readBuilder,
      eq: () => readBuilder,
      in: () => readBuilder,
      order: () => readBuilder,
      limit: () => readBuilder,
      single: () => Promise.resolve(pull()),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(pull()).then(resolve, reject),
    }
    return {
      ...readBuilder,
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, row })
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'p1' }, error: null }) }) }
      },
    }
  })
  return { client: { from }, inserted }
}

function claudeJson(obj: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] }
}

const shiftRow = (id: string, startAt: string, endAt: string, bookingId: string | null) => ({
  id,
  start_at: startAt,
  end_at: endAt,
  status: 'assigned',
  staff_id: 's1',
  booking_id: bookingId,
  fareharbor_availability_pk: null,
  staff: { name: 'Jip', hourly_rate_cents: 3000 },
  boats: { name: 'Diana', max_capacity: 8 },
})

const bookingRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  category: 'shared',
  customer_name: 'Lisa',
  customer_email: 'lisa@example.com',
  customer_phone: '+31600000000',
  extras_selected: null,
  listing_id: 'listing-1',
  listing_title: 'Canal Cruise',
  guest_count: 4,
  receipt_total: 12000,
  base_amount_cents: null,
  extras_amount_cents: null,
  fareharbor_availability_pk: null,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('draftGuestMoveForNewBooking', () => {
  it('skips WITHOUT syncing when an open move request already exists for that date (sequential invariant)', async () => {
    const { client } = makeSupabase({ agent_proposals: [{ data: [{ id: 'existing' }] }] })
    vi.mocked(createAdminClient).mockReturnValue(client as never)

    const result = await draftGuestMoveForNewBooking(DATE)

    expect(result).toBe('skipped')
    expect(syncShiftsForRange).not.toHaveBeenCalled()
  })

  it('skips when the single-day shift sync fails', async () => {
    const { client } = makeSupabase({ agent_proposals: [{ data: [] }] })
    vi.mocked(createAdminClient).mockReturnValue(client as never)
    vi.mocked(syncShiftsForRange).mockResolvedValue({ error: 'db down' })

    const result = await draftGuestMoveForNewBooking(DATE)

    expect(result).toBe('skipped')
    expect(syncShiftsForRange).toHaveBeenCalledWith(client, DATE, DATE)
    expect(meteredMessage).not.toHaveBeenCalled()
  })

  it('skips when the date still has only one sailing (no second booking yet)', async () => {
    const { client } = makeSupabase({
      agent_proposals: [{ data: [] }],
      shifts: [{ data: [shiftRow('sh1', '2026-07-05T10:00:00Z', '2026-07-05T12:00:00Z', 'b1')] }],
      bookings: [{ data: [bookingRow('b1')] }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client as never)
    vi.mocked(syncShiftsForRange).mockResolvedValue({ created: 1, updated: 0, skipped: [] })

    const result = await draftGuestMoveForNewBooking(DATE)

    expect(result).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled() // skip-first: no AI call when there's nothing to see
  })

  it('drafts a proposal when the new booking creates a real gap-closing candidate AND FareHarbor confirms the slot', async () => {
    const { client, inserted } = makeSupabase({
      agent_proposals: [{ data: [] }],
      shifts: [
        {
          data: [
            shiftRow('sh1', '2026-07-05T10:00:00Z', '2026-07-05T12:00:00Z', 'b1'),
            shiftRow('sh2', '2026-07-05T13:30:00Z', '2026-07-05T15:00:00Z', 'b2'),
          ],
        },
      ],
      bookings: [{ data: [bookingRow('b1'), bookingRow('b2')] }],
      cruise_listings: [{ data: { slug: 'canal-cruise' } }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client as never)
    vi.mocked(syncShiftsForRange).mockResolvedValue({ created: 1, updated: 0, skipped: [] })
    // Live availability: a real Diana slot exactly at the geometric ideal (12:00).
    vi.mocked(fetchSearchResults).mockResolvedValue([
      {
        listing: { slug: 'canal-cruise' },
        availableSlots: [
          {
            pk: 999,
            startAt: '2026-07-05T12:00:00Z',
            startTime: '2pm',
            endAt: '2026-07-05T13:30:00Z',
            headline: '',
            capacity: 12,
            customerTypes: [
              { pk: 555, boatId: 'diana', durationMinutes: 90, minimumParty: 1, maximumParty: 12, priceCents: 3500, name: 'Adult (13+)', totalCapacity: 12, customerTypePk: 1 },
            ],
          },
        ],
        date: DATE,
        guests: 4,
      },
    ] as never)
    fhValidate.mockResolvedValue({ is_bookable: true, receipt_total: 14000 })
    vi.mocked(meteredMessage).mockResolvedValue(
      claudeJson({
        sms_text: 'Hey! Would 12:00 work instead of 13:30? {{link}}',
        email_subject: 'Small favour',
        email_body: 'Would 12:00 work instead? {{link}}',
      }) as never,
    )

    const result = await draftGuestMoveForNewBooking(DATE)

    expect(result).toBe('drafted')
    expect(syncShiftsForRange).toHaveBeenCalledWith(client, DATE, DATE)
    // Shared booking of 4 → the WHOLE party is validated, not one seat.
    expect(fhValidate).toHaveBeenCalledWith(999, expect.objectContaining({
      customers: [
        { customer_type_rate: 555 },
        { customer_type_rate: 555 },
        { customer_type_rate: 555 },
        { customer_type_rate: 555 },
      ],
    }))
    expect(inserted).toHaveLength(1)
    expect(inserted[0].table).toBe('agent_proposals')
    const row = inserted[0].row as { kind: string; payload: Record<string, unknown> }
    expect(row.kind).toBe('guest_move_request')
    // The dry-run trail rides along in the payload for the send-time re-check.
    expect(row.payload.listing_slug).toBe('canal-cruise')
    expect(row.payload.customer_type_rate_pk).toBe(555)
    expect(row.payload.fh_customer_count).toBe(4)
    expect((row.payload.verdict as { is_bookable: boolean }).is_bookable).toBe(true)
    expect(emitOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'recommendation_created', source: 'ghost/guest-move-drafter:new-booking' }),
    )
  })

  it('drafts NOTHING when FareHarbor has no bookable slot in the snap window', async () => {
    const { client, inserted } = makeSupabase({
      agent_proposals: [{ data: [] }],
      shifts: [
        {
          data: [
            shiftRow('sh1', '2026-07-05T10:00:00Z', '2026-07-05T12:00:00Z', 'b1'),
            shiftRow('sh2', '2026-07-05T13:30:00Z', '2026-07-05T15:00:00Z', 'b2'),
          ],
        },
      ],
      bookings: [{ data: [bookingRow('b1'), bookingRow('b2')] }],
      cruise_listings: [{ data: { slug: 'canal-cruise' } }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client as never)
    vi.mocked(syncShiftsForRange).mockResolvedValue({ created: 0, updated: 0, skipped: [] })
    // No slots at all in the window → nothing to promise a guest.
    vi.mocked(fetchSearchResults).mockResolvedValue([
      { listing: { slug: 'canal-cruise' }, availableSlots: [], date: DATE, guests: 4 },
    ] as never)

    const result = await draftGuestMoveForNewBooking(DATE)

    expect(result).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled() // no Claude spend on an unbookable ask
    expect(inserted).toHaveLength(0)
  })
})
