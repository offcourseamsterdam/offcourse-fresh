import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  loadRuleContext: vi.fn(),
  classifyAndApply: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/finance/cockpit/classify/apply', () => ({ loadRuleContext: h.loadRuleContext, classifyAndApply: h.classifyAndApply }))

import { POST } from './route'

const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/transactions/classify-batch'
const ROWS = [
  { id: 'a', amount_cents: -100 },
  { id: 'b', amount_cents: 200 },
  { id: 'c', amount_cents: -300 },
]

function db(rows = ROWS) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'bank_transactions') return { data: rows }
    return { data: null }
  })
}

const req = (body?: unknown) => new NextRequest(BASE, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

describe('/api/admin/finance/cockpit/transactions/classify-batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.loadRuleContext.mockResolvedValue({ today: '2026-09-04' })
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await POST(req({}))).status).toBe(401)
    expect(h.createAdminClient).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range limit', async () => {
    expect((await POST(req({ limit: 0 }))).status).toBe(400)
    expect((await POST(req({ limit: 501 }))).status).toBe(400)
    expect((await POST(req({ limit: 1.5 }))).status).toBe(400)
    expect(h.createAdminClient).not.toHaveBeenCalled()
  })

  it('defaults to 50, orders ascending by created_at, and filters category IS NULL', async () => {
    const mock = db([])
    h.createAdminClient.mockReturnValue(mock.client)
    await POST(req({}))
    const q = mock.queries.find(q => q.table === 'bank_transactions')!
    expect(op(q, 'is')?.args).toEqual(['category', null])
    expect(op(q, 'order')?.args).toEqual(['created_at', { ascending: true }])
    expect(op(q, 'limit')?.args).toEqual([50])
  })

  it('caps an explicit limit at 500', async () => {
    const mock = db([])
    h.createAdminClient.mockReturnValue(mock.client)
    await POST(req({ limit: 500 }))
    const q = mock.queries.find(q => q.table === 'bank_transactions')!
    expect(op(q, 'limit')?.args).toEqual([500])
  })

  it('classifies every loaded row and tallies the outcome buckets', async () => {
    h.createAdminClient.mockReturnValue(db().client)
    h.classifyAndApply
      .mockResolvedValueOnce({ transactionId: 'a', classification: { category: 'operating' }, needsReview: false, changes: [], reversed: 0 })
      .mockResolvedValueOnce({ transactionId: 'b', classification: { category: 'income' }, needsReview: true, changes: [], reversed: 0 })
      .mockResolvedValueOnce({ transactionId: 'c', classification: null, needsReview: true, changes: [], reversed: 0 })

    const res = await POST(req({ limit: 3 }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toEqual({ processed: 3, classified: 1, needsReview: 1, unresolved: 1 })
    expect(h.loadRuleContext).toHaveBeenCalledTimes(1)
    expect(h.classifyAndApply).toHaveBeenCalledTimes(3)
    expect(h.classifyAndApply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'a' }), expect.anything(), { actor: 'cron' })
  })

  it('short-circuits with zero counts when nothing is unclassified', async () => {
    h.createAdminClient.mockReturnValue(db([]).client)
    const res = await POST(req({}))
    const { data } = await res.json()
    expect(data).toEqual({ processed: 0, classified: 0, needsReview: 0, unresolved: 0 })
    expect(h.loadRuleContext).not.toHaveBeenCalled()
  })
})
