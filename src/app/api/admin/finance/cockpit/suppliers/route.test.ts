import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET, POST } from './route'

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

describe('POST /api/admin/finance/cockpit/suppliers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  const post = (body: unknown) => POST(new NextRequest('https://offcourseamsterdam.com/api/admin/finance/cockpit/suppliers', { method: 'POST', body: JSON.stringify(body) }))

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 403 }))
    expect((await post({ name: 'X', iban: 'NL91ABNA0417164300' })).status).toBe(403)
  })

  it('rejects a missing name or IBAN before ever touching the database', async () => {
    const mock = createSupabaseChainMock(() => ({ data: null }))
    h.createAdminClient.mockReturnValue(mock.client)
    expect((await post({ name: '', iban: 'NL91ABNA0417164300' })).status).toBe(400)
    expect((await post({ name: 'X' })).status).toBe(400)
    expect(mock.queries).toHaveLength(0)
  })

  it('rejects an IBAN that fails its checksum, still before touching the database', async () => {
    const mock = createSupabaseChainMock(() => ({ data: null }))
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await post({ name: 'Jachthaven Westerdok', iban: 'NL91ABNA0417164301' })
    expect(res.status).toBe(400)
    expect(mock.queries).toHaveLength(0)
  })

  it('creates the supplier with a normalised IBAN, logs the event, and reports has_iban true — never the IBAN itself', async () => {
    const mock = createSupabaseChainMock((q: RecordedQuery) => {
      if (q.table === 'finance_suppliers' && has(q, 'insert')) return { data: { id: 'sup-new', name: 'Jachthaven Westerdok', staff_id: null, iban: 'NL91ABNA0417164300' } }
      return { data: null }
    })
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await post({ name: 'Jachthaven Westerdok', iban: 'nl91 abna 0417 1643 00' })
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data).toEqual({ id: 'sup-new', name: 'Jachthaven Westerdok', staff_id: null, has_iban: true })
    expect(JSON.stringify(data)).not.toContain('NL91')
    expect(opArg(mock.queries, 'finance_suppliers', 'insert')).toEqual({ name: 'Jachthaven Westerdok', iban: 'NL91ABNA0417164300' })
    expect(opArg(mock.queries, 'finance_events', 'insert')).toMatchObject({ event_type: 'supplier_created', entity_type: 'supplier', entity_id: 'sup-new' })
  })
})
