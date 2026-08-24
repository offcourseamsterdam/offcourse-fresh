import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { POST, DELETE } from './route'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

function makeReq(url: string, body?: unknown) {
  return { url: `http://x${url}`, json: async () => body } as never
}

function makeSupabase() {
  const inserts: Record<string, unknown>[] = []
  const deletes: string[] = []
  const client = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row)
        return {
          select: () => ({
            single: async () => ({ data: { id: 'new-id', ...row }, error: null }),
          }),
        }
      },
      delete: () => ({
        eq: async (_col: string, id: string) => {
          deletes.push(id)
          return { error: null }
        },
      }),
    }),
  }
  return { client: client as never, inserts, deletes }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdmin).mockResolvedValue(null)
})

describe('POST /api/admin/scheduling/extra-hours-bonus', () => {
  it('computes 50% commission from what was charged and stores it', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await POST(
      makeReq('/api/admin/scheduling/extra-hours-bonus', {
        staff_id: '11111111-1111-4111-8111-111111111111',
        date: '2026-08-24',
        extra_minutes: 30,
        amount_charged_cents: 2000,
      }),
    )
    expect(res.status).toBe(200)
    expect(sb.inserts[0]).toMatchObject({ amount_charged_cents: 2000, commission_cents: 1000, note: null })
  })

  it('rejects a non-positive amount charged', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await POST(
      makeReq('/api/admin/scheduling/extra-hours-bonus', {
        staff_id: '11111111-1111-4111-8111-111111111111',
        date: '2026-08-24',
        extra_minutes: 30,
        amount_charged_cents: 0,
      }),
    )
    expect(res.status).toBe(400)
    expect(sb.inserts).toHaveLength(0)
  })

  it('rejects when not an admin', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ status: 403 } as never)
    const res = await POST(makeReq('/api/admin/scheduling/extra-hours-bonus', {}))
    expect(res).toEqual({ status: 403 })
  })
})

describe('DELETE /api/admin/scheduling/extra-hours-bonus', () => {
  it('removes the entry by id', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await DELETE(makeReq('/api/admin/scheduling/extra-hours-bonus?id=abc-123'))
    expect(res.status).toBe(200)
    expect(sb.deletes).toEqual(['abc-123'])
  })

  it('rejects a missing id', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client)

    const res = await DELETE(makeReq('/api/admin/scheduling/extra-hours-bonus'))
    expect(res.status).toBe(400)
    expect(sb.deletes).toHaveLength(0)
  })
})
