import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { createSupabaseChainMock, op, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET } from './route'

const ROWS = [{ id: 'sup-1', name: 'Mare', staff_id: 'staff-1', iban: null }]

describe('GET /api/admin/finance/cockpit/suppliers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await GET()).status).toBe(401)
  })

  it('returns active suppliers ordered by name', async () => {
    const mock = createSupabaseChainMock((q: RecordedQuery) => ({ data: ROWS }))
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(ROWS)
    const q = mock.queries[0]
    expect(op(q, 'eq')?.args).toEqual(['is_active', true])
    expect(op(q, 'order')?.args[0]).toBe('name')
  })
})
