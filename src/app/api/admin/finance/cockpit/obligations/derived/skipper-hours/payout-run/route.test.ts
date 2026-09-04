import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET } from './route'

const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/obligations/derived/skipper-hours/payout-run'
const STAFF_ID = '88888888-8888-4888-8888-888888888888'

function db() {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'shifts') return { data: [{ id: 's1', staff_id: STAFF_ID, date: '2026-08-10', start_at: '2026-08-10T10:00:00.000Z', end_at: '2026-08-10T14:00:00.000Z', status: 'completed' }] }
    if (q.table === 'time_entries') return { data: [] }
    if (q.table === 'extra_hours_bonuses') return { data: [] }
    if (q.table === 'staff') return { data: [{ id: STAFF_ID, name: 'Bo', hourly_rate_cents: 2_500, is_active: true }] }
    return { data: null }
  })
}

const req = (path = '') => new NextRequest(`${BASE}${path}`)

describe('/api/admin/finance/cockpit/obligations/derived/skipper-hours/payout-run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await GET(req('?month=2026-08'))).status).toBe(401)
  })

  it('requires month', async () => {
    h.createAdminClient.mockReturnValue(db().client)
    expect((await GET(req())).status).toBe(400)
    expect((await GET(req('?month=bad'))).status).toBe(400)
  })

  it('builds one payout-run line for the requested month', async () => {
    h.createAdminClient.mockReturnValue(db().client)
    const res = await GET(req('?month=2026-08'))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.month).toBe('2026-08')
    expect(data.lines).toEqual([{ staffId: STAFF_ID, staffName: 'Bo', amountCents: 10_000, hours: 4, reference: 'Uren 2026-08 (4 uur)' }])
    expect(data.totalCents).toBe(10_000)
    expect(data.blocked).toEqual([])
  })
})
