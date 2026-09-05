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

const DB_ROWS = [{ id: 'sup-1', name: 'Mare', staff_id: 'staff-1', iban: null }]
// The route strips iban down to a boolean before it reaches the browser.
const EXPECTED = [{ id: 'sup-1', name: 'Mare', staff_id: 'staff-1', has_iban: false }]

describe('GET /api/admin/finance/cockpit/suppliers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await GET()).status).toBe(401)
  })

  it('returns active suppliers ordered by name, with has_iban instead of the raw IBAN', async () => {
    const mock = createSupabaseChainMock((q: RecordedQuery) => ({ data: DB_ROWS }))
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(EXPECTED)
    const q = mock.queries[0]
    expect(op(q, 'eq')?.args).toEqual(['is_active', true])
    expect(op(q, 'order')?.args[0]).toBe('name')
  })

  it('a supplier with an IBAN on file reports has_iban true, never the IBAN itself', async () => {
    const mock = createSupabaseChainMock(() => ({ data: [{ id: 'sup-2', name: 'Jachthaven', staff_id: null, iban: 'NL91ABNA0417164300' }] }))
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET()
    const data = (await res.json()).data
    expect(data).toEqual([{ id: 'sup-2', name: 'Jachthaven', staff_id: null, has_iban: true }])
    expect(JSON.stringify(data)).not.toContain('NL91')
  })
})
