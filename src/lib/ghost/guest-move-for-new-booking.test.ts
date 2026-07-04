import { describe, it, expect, vi, beforeEach } from 'vitest'

// vitest hoists vi.mock above the imports below.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ meteredMessage: vi.fn() }))
vi.mock('@/lib/scheduling/sync-shifts', () => ({ syncShiftsForRange: vi.fn() }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: vi.fn().mockResolvedValue(undefined) }))

import { draftGuestMoveForNewBooking } from './guest-move-drafter'
import { createAdminClient } from '@/lib/supabase/admin'
import { meteredMessage } from '@/lib/ai/usage'
import { syncShiftsForRange } from '@/lib/scheduling/sync-shifts'
import { emitOpsEvent } from '@/lib/ops/events'

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
    const readBuilder: Record<string, unknown> = {
      select: () => readBuilder,
      eq: () => readBuilder,
      in: () => readBuilder,
      order: () => readBuilder,
      limit: () => readBuilder,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const q = queues[table]
        const result = q && q.length ? q.shift() : { data: null, error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
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

  it('drafts a proposal when the new booking creates a real gap-closing candidate', async () => {
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
    })
    vi.mocked(createAdminClient).mockReturnValue(client as never)
    vi.mocked(syncShiftsForRange).mockResolvedValue({ created: 1, updated: 0, skipped: [] })
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
    expect(inserted).toHaveLength(1)
    expect(inserted[0].table).toBe('agent_proposals')
    expect(inserted[0].row.kind).toBe('guest_move_request')
    expect(emitOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'recommendation_created', source: 'ghost/guest-move-drafter:new-booking' }),
    )
  })
})
