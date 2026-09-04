import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'

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

const ID = '55555555-5555-4555-8555-555555555555'
const BASE = `https://offcourseamsterdam.com/api/admin/finance/cockpit/transactions/${ID}/classify`
const ROW = { id: ID, amount_cents: -2500, description: 'Bo de Boer', allocation_applied: null, reviewed_at: null }

function db(row: typeof ROW | null = ROW, ruleInsertError: { code: string; message: string } | null = null) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'bank_transactions') return { data: row }
    if (q.table === 'finance_classification_rules') {
      if (has(q, 'insert')) {
        if (ruleInsertError) return { data: null, error: ruleInsertError }
        return { data: { id: 'rule-1' } }
      }
    }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

const req = (body?: unknown) => new NextRequest(BASE, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const params = (id = ID) => ({ params: Promise.resolve({ id }) })
const OUTCOME = {
  transactionId: ID,
  classification: { category: 'operating', subcategory: 'crew', confidence: 1, reason: 'Handmatig door Beer', source: 'user' },
  needsReview: false,
  changes: [],
  reversed: 0,
}

describe('/api/admin/finance/cockpit/transactions/[id]/classify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.loadRuleContext.mockResolvedValue({ today: '2026-09-04' })
    h.classifyAndApply.mockResolvedValue(OUTCOME)
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await POST(req({ category: 'operating' }), params())).status).toBe(401)
    expect(h.createAdminClient).not.toHaveBeenCalled()
  })

  it('rejects an invalid id and invalid bodies', async () => {
    expect((await POST(req({ category: 'operating' }), params('not-a-uuid'))).status).toBe(400)
    expect((await POST(req({ category: 'not-a-real-category' }), params())).status).toBe(400)
    expect((await POST(req({ category: 'operating', subcategory: 'not-a-real-subcategory' }), params())).status).toBe(400)
    expect((await POST(req({ category: 'operating', remember_rule: true }), params())).status).toBe(400)
    expect(h.createAdminClient).not.toHaveBeenCalled()
  })

  it('404s when the transaction does not exist', async () => {
    h.createAdminClient.mockReturnValue(db(null).client)
    expect((await POST(req({ category: 'operating' }), params())).status).toBe(404)
    expect(h.classifyAndApply).not.toHaveBeenCalled()
  })

  it('classifies as a user decision and returns the outcome', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req({ category: 'operating', subcategory: 'crew', boat_id: null }), params())
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.ruleCreated).toBe(false)
    expect(data.outcome).toEqual(OUTCOME)

    expect(h.classifyAndApply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: ID }),
      expect.anything(),
      expect.objectContaining({
        actor: 'user',
        userClassification: expect.objectContaining({
          category: 'operating', subcategory: 'crew', boatId: null, goalId: null, confidence: 1, source: 'user', reason: 'Handmatig door Beer',
        }),
      }),
    )
  })

  it('creates and logs a rule when remember_rule is set', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(
      req({ category: 'operating', subcategory: 'crew', remember_rule: true, rule: { match_field: 'counterparty_name', pattern: '  Bo de Boer  ', direction: 'out' } }),
      params(),
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.ruleCreated).toBe(true)
    expect(opArg(mock.queries, 'finance_classification_rules', 'insert')).toMatchObject({
      pattern: 'bo de boer', match_field: 'counterparty_name', direction: 'out', category: 'operating', subcategory: 'crew', created_from_transaction_id: ID,
    })
    const events = queriesFor(mock.queries, 'finance_events', 'insert')
    expect(events).toHaveLength(1)
    expect(op(events[0], 'insert')!.args[0]).toMatchObject({ event_type: 'classification_rule_created', entity_type: 'classification_rule', entity_id: 'rule-1' })
  })

  it('returns 409 on a duplicate rule pattern without failing the classification', async () => {
    h.createAdminClient.mockReturnValue(db(ROW, { code: '23505', message: 'duplicate key value' }).client)
    const res = await POST(
      req({ category: 'operating', remember_rule: true, rule: { match_field: 'counterparty_name', pattern: 'xx', direction: 'out' } }),
      params(),
    )
    expect(res.status).toBe(409)
    expect(h.classifyAndApply).toHaveBeenCalled()
  })
})
