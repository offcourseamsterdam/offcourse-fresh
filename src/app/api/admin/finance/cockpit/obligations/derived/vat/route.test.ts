import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  computeBtwDashboard: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/finance/btw-dashboard-calculator', () => ({ computeBtwDashboard: h.computeBtwDashboard }))

import { GET, POST } from './route'

const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/obligations/derived/vat'

const QUARTERS = [
  { quarter: '2025-Q4', vat9OwedCents: 100_000, vat21OwedCents: 20_000, vat21DeductibleCents: 5_000, netIndicationCents: 115_000, bySource: {} },
  { quarter: '2026-Q1', vat9OwedCents: 0, vat21OwedCents: 0, vat21DeductibleCents: 10_000, netIndicationCents: -10_000, bySource: {} },
]

function db(insertError: { code: string; message: string } | null = null) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_obligations') {
      if (has(q, 'insert')) {
        if (insertError) return { data: null, error: insertError }
        return { data: { id: 'ob-vat-1', ...(op(q, 'insert')!.args[0] as object) } }
      }
    }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

const req = (method: string, body?: unknown) => new NextRequest(BASE, { method, body: body === undefined ? undefined : JSON.stringify(body) })

describe('/api/admin/finance/cockpit/obligations/derived/vat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.computeBtwDashboard.mockResolvedValue({ quarters: QUARTERS, totals: {}, months: [] })
  })

  describe('GET', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await GET()).status).toBe(401)
      expect(h.computeBtwDashboard).not.toHaveBeenCalled()
    })

    it('only proposes the quarter that actually owes money', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      const res = await GET()
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.proposals).toHaveLength(1)
      expect(data.proposals[0]).toMatchObject({ key: 'vat:2025-Q4', amountCents: 115_000 })
    })
  })

  describe('POST', () => {
    it('rejects an empty keys array', async () => {
      expect((await POST(req('POST', { keys: [] }))).status).toBe(400)
      expect(h.createAdminClient).not.toHaveBeenCalled()
    })

    it('confirms a known quarter and logs obligation_created', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await POST(req('POST', { keys: ['vat:2025-Q4'] }))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.created).toEqual([{ key: 'vat:2025-Q4', id: 'ob-vat-1' }])
      const insertQuery = queriesFor(mock.queries, 'finance_obligations', 'insert')[0]
      expect(op(insertQuery, 'insert')!.args[0]).toMatchObject({ kind: 'tax', amount_cents: 115_000, source_key: 'vat:2025-Q4', status: 'open' })
      expect(queriesFor(mock.queries, 'finance_events', 'insert')).toHaveLength(1)
    })

    it('skips a quarter with a net refund (never proposed) as unknown', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      const res = await POST(req('POST', { keys: ['vat:2026-Q1'] }))
      const { data } = await res.json()
      expect(data.created).toEqual([])
      expect(data.skipped[0]).toMatchObject({ key: 'vat:2026-Q1' })
    })

    it('is idempotent on a source_key conflict', async () => {
      h.createAdminClient.mockReturnValue(db({ code: '23505', message: 'duplicate' }).client)
      const res = await POST(req('POST', { keys: ['vat:2025-Q4'] }))
      const { data } = await res.json()
      expect(data.created).toEqual([])
      expect(data.skipped).toEqual([{ key: 'vat:2025-Q4', reason: 'already existed' }])
    })
  })
})
