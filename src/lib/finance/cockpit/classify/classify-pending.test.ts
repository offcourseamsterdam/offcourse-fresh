import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseChainMock, op, type RecordedQuery } from '@/test/supabase-chain-mock'

// No model calls in a unit test: every row here falls through to the AI and
// gets "not confident", which is exactly the path the retry fix is about.
vi.mock('./ai', async importOriginal => ({ ...(await importOriginal<typeof import('./ai')>()), classifyWithAi: vi.fn().mockResolvedValue(null) }))
vi.mock('../reconcile/channel-matcher', async importOriginal => ({
  ...(await importOriginal<typeof import('../reconcile/channel-matcher')>()),
  loadPayoutCandidatePool: vi.fn().mockResolvedValue(undefined),
}))

import { classifyPending } from './apply'

const row = (id: string) => ({
  id, revolut_id: `r-${id}`, type: 'card_payment', state: 'completed', amount_cents: -1234, fee_cents: 0,
  created_at: '2026-09-20T10:00:00Z', reference: null, description: 'Some shop', counterparty: null,
  merchant: { name: 'Some shop' }, category: null, subcategory: null, needs_review: false,
  allocation_applied: null, reviewed_at: null,
})

function db(rows: unknown[]) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    const isPendingSelect = q.table === 'bank_transactions' && q.ops.some(o => o.method === 'is')
    if (isPendingSelect) return { data: rows }
    return { data: q.ops.some(o => o.method === 'maybeSingle' || o.method === 'single') ? null : [] }
  })
}

describe('classifyPending', () => {
  beforeEach(() => vi.clearAllMocks())

  it('only picks completed, uncategorised rows that are not already waiting for Beer', async () => {
    const mock = db([])
    await classifyPending(mock.client as never, { limit: 25 })
    const q = mock.queries.find(q => q.table === 'bank_transactions')!
    expect(op(q, 'is')?.args).toEqual(['category', null])
    const eqs = q.ops.filter(o => o.method === 'eq').map(o => o.args)
    expect(eqs).toContainEqual(['needs_review', false])
    expect(eqs).toContainEqual(['state', 'completed'])
    expect(op(q, 'order')?.args).toEqual(['created_at', { ascending: true }])
    expect(op(q, 'limit')?.args).toEqual([25])
  })

  it('a row the AI could not place is marked for review — so it is never retried (or paid for) again', async () => {
    const mock = db([row('a')])
    const result = await classifyPending(mock.client as never)
    expect(result).toMatchObject({ processed: 1, unresolved: 1 })
    const update = mock.queries.find(q => q.table === 'bank_transactions' && q.ops.some(o => o.method === 'update'))
    expect(op(update!, 'update')?.args[0]).toEqual({ needs_review: true })
  })

  it('stops starting new rows once its time budget is used, and says more remain', async () => {
    const mock = db([row('a'), row('b')])
    const result = await classifyPending(mock.client as never, { budgetMs: -1 })
    expect(result).toMatchObject({ processed: 0, remaining: true })
  })

  it('does nothing when there is nothing new', async () => {
    const result = await classifyPending(db([]).client as never)
    expect(result).toEqual({ processed: 0, classified: 0, needsReview: 0, unresolved: 0, remaining: false })
  })
})
