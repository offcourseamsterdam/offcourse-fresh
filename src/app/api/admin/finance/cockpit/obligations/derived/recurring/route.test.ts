import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'
import { todayISO } from '@/lib/finance/cockpit/dates'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET, POST } from './route'

const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/obligations/derived/recurring'

// Four monthly charges from "Schepenverzekering", one day apart each month (stable amount),
// which is enough occurrences+regularity for detectRecurring to propose a monthly pattern.
const TX_ROWS = ['2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05'].map((d, i) => ({
  id: `tx-${i}`,
  amount_cents: -12_000,
  created_at: `${d}T10:00:00.000Z`,
  merchant: { name: 'Schepenverzekering B.V.' },
  counterparty: null,
  description: null,
  category: 'operating',
  subcategory: 'insurance',
}))

function db(txRows = TX_ROWS, obligationTitles: string[] = [], insertError: { code: string; message: string } | null = null) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'bank_transactions') return { data: txRows }
    if (q.table === 'finance_obligations') {
      if (has(q, 'insert')) {
        if (insertError) return { data: null, error: insertError }
        return { data: { id: 'ob-rec-1', ...(op(q, 'insert')!.args[0] as object) } }
      }
      // Two different non-insert reads share this table: GET's bare
      // `select('title')` (existing obligation titles, for detectRecurring's
      // exclusion list) has no `.eq()` at all; upsertDerivedObligation's
      // pre-check `select(...).eq('source_key', ...).maybeSingle()` does —
      // distinguish them or the pre-check would misread the titles list as
      // "a settled row already exists" and skip every confirm.
      if (has(q, 'eq')) return { data: null }
      return { data: obligationTitles.map(title => ({ title })) }
    }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

const req = (method: string, body?: unknown, path = '') => new NextRequest(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })

describe('/api/admin/finance/cockpit/obligations/derived/recurring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  describe('GET', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await GET(req('GET'))).status).toBe(401)
    })

    it('rejects a malformed months value', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      expect((await GET(req('GET', undefined, '?months=abc'))).status).toBe(400)
      expect((await GET(req('GET', undefined, '?months=0'))).status).toBe(400)
    })

    it('scopes to outgoing, completed transactions since the lookback window (default 6 months) and detects a pattern', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await GET(req('GET'))
      expect(res.status).toBe(200)
      const txQuery = mock.queries.find(q => q.table === 'bank_transactions')!
      expect(op(txQuery, 'lt')?.args).toEqual(['amount_cents', 0])
      expect(op(txQuery, 'eq')?.args).toEqual(['state', 'completed'])
      expect(op(txQuery, 'gte')?.args[0]).toBe('created_at')

      const { data } = await res.json()
      expect(data.proposals.length).toBeGreaterThan(0)
      expect(data.proposals[0]).toMatchObject({ label: 'Schepenverzekering B.V.', intervalMonths: 1, amountCents: 12_000 })
    })

    it('excludes a label already covered by an existing obligation title', async () => {
      h.createAdminClient.mockReturnValue(db(TX_ROWS, ['Schepenverzekering B.V.']).client)
      const res = await GET(req('GET'))
      const { data } = await res.json()
      expect(data.proposals).toEqual([])
    })
  })

  describe('POST', () => {
    it('rejects an empty selections array', async () => {
      expect((await POST(req('POST', { selections: [] }))).status).toBe(400)
      expect(h.createAdminClient).not.toHaveBeenCalled()
    })

    it('confirms a selection with a picked kind and logs obligation_created', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const proposal = {
        key: 'recurring:schepenverzekering b.v.',
        label: 'Schepenverzekering B.V.',
        intervalMonths: 1,
        amountCents: 12_000,
        minAmountCents: 12_000,
        maxAmountCents: 12_000,
        amountVaries: false,
        occurrences: 4,
        firstSeen: '2026-05-05',
        lastSeen: '2026-08-05',
        nextExpected: '2026-09-05',
        confidence: 0.9,
        category: 'operating',
        subcategory: 'insurance',
      }
      const res = await POST(req('POST', { selections: [{ key: proposal.key, kind: 'insurance', proposal }] }))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.created).toEqual([{ key: proposal.key, id: 'ob-rec-1' }])

      const insertQuery = queriesFor(mock.queries, 'finance_obligations', 'insert')[0]
      expect(op(insertQuery, 'insert')!.args[0]).toMatchObject({
        title: 'Schepenverzekering B.V.', kind: 'insurance', amount_cents: 12_000, due_date: '2026-09-05', recurrence_months: 1, source_key: proposal.key,
      })
      expect(queriesFor(mock.queries, 'finance_events', 'insert')).toHaveLength(1)
    })

    it('is idempotent on a source_key conflict', async () => {
      h.createAdminClient.mockReturnValue(db(TX_ROWS, [], { code: '23505', message: 'duplicate' }).client)
      const proposal = {
        key: 'recurring:x', label: 'X', intervalMonths: 1 as const, amountCents: 1000, minAmountCents: 1000, maxAmountCents: 1000,
        amountVaries: false, occurrences: 3, firstSeen: todayISO(), lastSeen: todayISO(), nextExpected: todayISO(), confidence: 0.8, category: null, subcategory: null,
      }
      const res = await POST(req('POST', { selections: [{ key: proposal.key, kind: 'other', proposal }] }))
      const { data } = await res.json()
      expect(data.created).toEqual([])
      expect(data.skipped).toEqual([{ key: proposal.key, reason: 'already existed' }])
    })
  })
})
