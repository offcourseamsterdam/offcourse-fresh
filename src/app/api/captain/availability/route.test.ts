import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/require-captain', () => ({ requireCaptain: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { GET, PUT } from './route'
import { requireCaptain } from '@/lib/auth/require-captain'
import { createAdminClient } from '@/lib/supabase/admin'

const STAFF = { staff: { id: 'staff-1' } }

function makeReq(url: string, body?: unknown) {
  return {
    url: `http://x${url}`,
    json: async () => body,
  } as never
}

/** Captures every upsert/delete payload; GET returns whatever `rows` holds. */
function makeSupabase(rows: unknown[] = []) {
  const upserts: Record<string, unknown>[] = []
  const deletes: Record<string, unknown>[] = []
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ gte: () => ({ lte: async () => ({ data: rows, error: null }) }) }) }),
    upsert: (row: Record<string, unknown>) => {
      upserts.push(row)
      return { error: null }
    },
    delete: () => ({
      eq: () => ({
        eq: async () => {
          deletes.push({})
          return { error: null }
        },
      }),
    }),
  }))
  return { client: { from } as never, upserts, deletes }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireCaptain).mockResolvedValue(STAFF as never)
})

describe('GET /api/captain/availability', () => {
  it('trims Postgres TIME values ("HH:MM:SS") down to "HH:MM" for the UI', async () => {
    const sb = makeSupabase([
      { date: '2026-09-05', status: 'available', note: null, start_time: '10:00:00', end_time: '18:00:00' },
      { date: '2026-09-06', status: 'available', note: null, start_time: null, end_time: null },
    ])
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await GET(makeReq('/api/captain/availability?from=2026-09-01&to=2026-09-30'))
    const body = await res.json()

    expect(body.data.availability).toEqual([
      { date: '2026-09-05', status: 'available', startTime: '10:00', endTime: '18:00' },
      { date: '2026-09-06', status: 'available', startTime: null, endTime: null },
    ])
  })
})

describe('PUT /api/captain/availability', () => {
  it('sets a whole-day status with no time window when none is given — the unchanged default', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await PUT(makeReq('/api/captain/availability', { date: '2026-09-05', status: 'available' }))
    expect(res.status).toBe(200)
    expect(sb.upserts[0]).toMatchObject({ status: 'available', start_time: null, end_time: null })
  })

  it('stores a specific time window on an available day (Beer, 2026-08-23: "available between these and these times")', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await PUT(
      makeReq('/api/captain/availability', { date: '2026-09-05', status: 'available', startTime: '10:00', endTime: '18:00' }),
    )
    expect(res.status).toBe(200)
    expect(sb.upserts[0]).toMatchObject({ status: 'available', start_time: '10:00', end_time: '18:00' })
  })

  it('rejects "prefer_not" — the status was removed in favor of available + hours ("partly available")', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await PUT(makeReq('/api/captain/availability', { date: '2026-09-05', status: 'prefer_not' }))
    expect(res.status).toBe(400)
    expect(sb.upserts).toHaveLength(0)
  })

  it('forces the time window to null on "unavailable" — the whole day is out regardless of what was sent', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    await PUT(
      makeReq('/api/captain/availability', { date: '2026-09-05', status: 'unavailable', startTime: '10:00', endTime: '18:00' }),
    )
    expect(sb.upserts[0]).toMatchObject({ status: 'unavailable', start_time: null, end_time: null })
  })

  it('rejects a start time with no end time — an incomplete window is worse than none', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await PUT(makeReq('/api/captain/availability', { date: '2026-09-05', status: 'available', startTime: '10:00' }))
    expect(res.status).toBe(400)
    expect(sb.upserts).toHaveLength(0)
  })

  it('rejects an end time at or before the start time', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await PUT(
      makeReq('/api/captain/availability', { date: '2026-09-05', status: 'available', startTime: '18:00', endTime: '10:00' }),
    )
    expect(res.status).toBe(400)
    expect(sb.upserts).toHaveLength(0)
  })

  it('clearing a day (status: null) deletes the row — no separate time cleanup needed', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await PUT(makeReq('/api/captain/availability', { date: '2026-09-05', status: null }))
    expect(res.status).toBe(200)
    expect(sb.deletes).toHaveLength(1)
    expect(sb.upserts).toHaveLength(0)
  })
})
