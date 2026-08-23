import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/fareharbor/client', () => ({ getFareHarborClient: vi.fn() }))

import { PATCH } from './route'
import { createAdminClient } from '@/lib/supabase/admin'

function makeReq(body: unknown) {
  return { json: async () => body } as never
}

function makeSupabase(booking: unknown = { id: 'b1', booking_uuid: null, guest_note: null }) {
  const updates: Record<string, unknown>[] = []
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: booking }) }) }),
    update: (row: Record<string, unknown>) => {
      updates.push(row)
      return { eq: async () => ({ error: null }) }
    },
  }))
  return { client: { from } as never, updates }
}

const PARAMS = { params: Promise.resolve({ id: 'b1' }) }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/admin/bookings/[id] — no_reschedule_ask (Beer, 2026-08-23: anniversary/birthday bookings)', () => {
  it('sets the flag and stores the reason', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await PATCH(makeReq({ no_reschedule_ask: true, no_reschedule_reason: 'Anniversary' }), PARAMS)
    expect(res.status).toBe(200)
    expect(sb.updates[0]).toMatchObject({ no_reschedule_ask: true, no_reschedule_reason: 'Anniversary' })
  })

  it('clearing the flag also clears the stored reason — a stale note must not silently reappear', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await PATCH(makeReq({ no_reschedule_ask: false, no_reschedule_reason: 'Anniversary' }), PARAMS)
    expect(res.status).toBe(200)
    expect(sb.updates[0]).toMatchObject({ no_reschedule_ask: false, no_reschedule_reason: null })
  })

  it('setting the flag with no reason text stores a null reason, not an empty string', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    await PATCH(makeReq({ no_reschedule_ask: true }), PARAMS)
    expect(sb.updates[0]).toMatchObject({ no_reschedule_ask: true, no_reschedule_reason: null })
  })

  it('returns 404 without writing anything when the booking does not exist', async () => {
    const sb = makeSupabase(null)
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await PATCH(makeReq({ no_reschedule_ask: true }), PARAMS)
    expect(res.status).toBe(404)
    expect(sb.updates).toHaveLength(0)
  })
})
