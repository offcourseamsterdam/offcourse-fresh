import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET } from './route'

const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/obligations/derived/catering'
const EXTRA_ID = '99999999-9999-4999-8999-999999999999'

const BOOKING_ROWS = [
  { extras_selected: [{ extra_id: EXTRA_ID, quantity: 2 }], booking_date: '2026-08-15', status: 'confirmed' },
  { extras_selected: [{ extra_id: EXTRA_ID, quantity: 5 }], booking_date: '2026-08-16', status: 'cancelled' }, // excluded: not active
  { extras_selected: [{ quantity: 1 }], booking_date: '2026-08-17', status: 'confirmed' }, // excluded: no extra_id
]
const EXTRA_ROWS = [{ id: EXTRA_ID, name: 'Borrelplank', category: 'food', price_value: 1_300 }] // sell €13, cost = 13/1.3 = €10

function db(bookingRows = BOOKING_ROWS, extraRows = EXTRA_ROWS) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'bookings') return { data: bookingRows }
    if (q.table === 'extras') return { data: extraRows }
    return { data: null }
  })
}

const req = (path = '') => new NextRequest(`${BASE}${path}`)

describe('/api/admin/finance/cockpit/obligations/derived/catering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await GET(req('?from=2026-08-01&to=2026-08-31'))).status).toBe(401)
  })

  it('requires from and to as YYYY-MM-DD', async () => {
    h.createAdminClient.mockReturnValue(db().client)
    expect((await GET(req('?to=2026-08-31'))).status).toBe(400)
    expect((await GET(req('?from=2026-08-01'))).status).toBe(400)
    expect((await GET(req('?from=bad&to=2026-08-31'))).status).toBe(400)
  })

  it('joins active bookings with an extra_id to the catalogue and estimates cost, excluding cancelled/unlinked lines', async () => {
    h.createAdminClient.mockReturnValue(db().client)
    const res = await GET(req('?from=2026-08-01&to=2026-08-31'))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    // Only the confirmed booking with an extra_id counts: quantity 2 × €10 cost = €20 = 2000 cents.
    expect(data.estimate.lineCount).toBe(1)
    expect(data.estimate.estimatedCostCents).toBe(2_000)
    expect(data.estimate.estimatedSellCents).toBe(2_600)
    expect(data.note).toMatch(/1,30/)
  })

  it('never exposes a POST/confirm endpoint', async () => {
    const mod = await import('./route')
    expect((mod as Record<string, unknown>).POST).toBeUndefined()
  })
})
