import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

import { GET } from './route'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

function makeSupabase({
  proposals,
  shifts,
}: {
  proposals: { id: string; payload: unknown; reasoning: string | null; outcome: unknown; created_at: string }[]
  shifts?: { id: string; notified_at: string | null }[]
}) {
  const from = vi.fn((table: string) => {
    if (table === 'agent_proposals') {
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        order: () => Promise.resolve({ data: proposals, error: null }),
      }
      return builder
    }
    if (table === 'shifts') {
      return { select: () => ({ in: () => Promise.resolve({ data: shifts ?? [] }) }) }
    }
    throw new Error(`unexpected table: ${table}`)
  })
  return { from }
}

function makeReq(qs: string) {
  return new Request(`http://localhost/api/admin/planning/ghost-activity${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/planning/ghost-activity', () => {
  it('requires from and to', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ proposals: [] }) as never)
    const res = await GET(makeReq(''))
    expect(res.status).toBe(400)
  })

  it('returns an empty list when nothing executed in range', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ proposals: [] }) as never)
    const res = await GET(makeReq('?from=2026-08-01&to=2026-08-07'))
    const body = await res.json()
    expect(body.data).toEqual([])
  })

  it('reports notifiedCount/totalCount from LIVE shift state, not the stored payload', async () => {
    const sb = makeSupabase({
      proposals: [
        {
          id: 'p1',
          payload: {
            target_date: '2026-08-06',
            assignments: [
              { shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne', cost_cents: 5000 },
              { shift_id: 's2', staff_id: 'cap2', staff_name: 'Joris', cost_cents: 3000 },
            ],
          },
          reasoning: 'Both available and fair.',
          outcome: { applied_at: '2026-08-06T10:00:00Z' },
          created_at: '2026-08-06T10:00:00Z',
        },
      ],
      shifts: [
        { id: 's1', notified_at: '2026-08-06T11:00:00Z' }, // already confirmed
        { id: 's2', notified_at: null }, // still pending confirm
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb as never)

    const res = await GET(makeReq('?from=2026-08-01&to=2026-08-09'))
    const body = await res.json()

    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      id: 'p1',
      target_date: '2026-08-06',
      notifiedCount: 1,
      totalCount: 2,
    })
  })

  it('does not query shifts at all when no proposal has any assignments', async () => {
    const sb = makeSupabase({
      proposals: [
        { id: 'p1', payload: { target_date: '2026-08-06', assignments: [] }, reasoning: null, outcome: null, created_at: '2026-08-06T10:00:00Z' },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb as never)

    const res = await GET(makeReq('?from=2026-08-01&to=2026-08-09'))
    const body = await res.json()

    expect(body.data[0]).toMatchObject({ notifiedCount: 0, totalCount: 0 })
    expect(sb.from).not.toHaveBeenCalledWith('shifts')
  })
})
