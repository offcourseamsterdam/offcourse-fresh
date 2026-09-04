import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET, POST } from './route'
import { PUT, DELETE } from './[id]/route'

const ID = '66666666-6666-4666-8666-666666666666'
const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/classification-rules'
const ROW = {
  id: ID,
  match_field: 'counterparty_name',
  pattern: 'taste vin',
  direction: 'out',
  category: 'operating',
  subcategory: 'catering',
  boat_id: null,
  goal_id: null,
  priority: 100,
  is_active: true,
  created_from_transaction_id: null,
  hit_count: 0,
  last_hit_at: null,
  note: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
}

function db(row: typeof ROW | null = ROW, insertError: { code: string; message: string } | null = null) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_classification_rules') {
      if (has(q, 'insert')) {
        if (insertError) return { data: null, error: insertError }
        return { data: { ...ROW, ...(op(q, 'insert')!.args[0] as object), id: ID } }
      }
      if (has(q, 'update')) {
        if (insertError) return { data: null, error: insertError }
        return { data: { ...(row ?? ROW), ...(op(q, 'update')!.args[0] as object) } }
      }
      if (has(q, 'maybeSingle')) return { data: row }
      return { data: row ? [row] : [] }
    }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

const req = (method: string, body?: unknown) => new NextRequest(BASE, { method, body: body === undefined ? undefined : JSON.stringify(body) })
const params = (id = ID) => ({ params: Promise.resolve({ id }) })
const events = (queries: RecordedQuery[]) => queriesFor(queries, 'finance_events', 'insert').map(q => op(q, 'insert')!.args[0] as Record<string, unknown>)

describe('/api/admin/finance/cockpit/classification-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  describe('GET', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await GET()).status).toBe(401)
    })

    it('lists every rule newest first', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await GET()
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data).toHaveLength(1)
      expect(op(mock.queries[0], 'order')?.args).toEqual(['created_at', { ascending: false }])
    })
  })

  describe('POST', () => {
    it('rejects invalid bodies with 400', async () => {
      expect((await POST(req('POST', { pattern: 'x' }))).status).toBe(400) // missing fields, pattern too short
      expect((await POST(req('POST', { match_field: 'bad', pattern: 'ab', direction: 'out', category: 'operating' }))).status).toBe(400)
      expect((await POST(req('POST', { match_field: 'counterparty_name', pattern: 'ab', direction: 'out', category: 'not-a-category' }))).status).toBe(400)
      expect((await POST(req('POST', { match_field: 'counterparty_name', pattern: 'ab', direction: 'out', category: 'operating', subcategory: 'nope' }))).status).toBe(400)
      expect(h.createAdminClient).not.toHaveBeenCalled()
    })

    it('creates with defaults, lowercases the pattern, and logs the event', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await POST(req('POST', { match_field: 'counterparty_name', pattern: '  Taste Vin  ', direction: 'out', category: 'operating', subcategory: 'catering' }))
      expect(res.status).toBe(201)
      expect(opArg(mock.queries, 'finance_classification_rules', 'insert')).toMatchObject({ pattern: 'taste vin', priority: 100 })
      expect(events(mock.queries)[0]).toMatchObject({ event_type: 'classification_rule_created', entity_type: 'classification_rule', entity_id: ID })
    })

    it('returns 409 on a duplicate pattern/field/direction', async () => {
      h.createAdminClient.mockReturnValue(db(ROW, { code: '23505', message: 'duplicate' }).client)
      const res = await POST(req('POST', { match_field: 'counterparty_name', pattern: 'taste vin', direction: 'out', category: 'operating' }))
      expect(res.status).toBe(409)
    })
  })

  describe('[id] PUT', () => {
    it('rejects a bad id and an empty patch', async () => {
      expect((await PUT(req('PUT', { note: 'x' }), params('nope'))).status).toBe(400)
      expect((await PUT(req('PUT', {}), params())).status).toBe(400)
    })

    it('404s when the rule is missing', async () => {
      h.createAdminClient.mockReturnValue(db(null).client)
      expect((await PUT(req('PUT', { note: 'x' }), params())).status).toBe(404)
    })

    it('updates, lowercases a changed pattern, and logs classification_rule_updated', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await PUT(req('PUT', { pattern: 'DRANKENGILDE' }), params())
      expect(res.status).toBe(200)
      expect(opArg(mock.queries, 'finance_classification_rules', 'update')).toMatchObject({ pattern: 'drankengilde' })
      expect(events(mock.queries)[0]).toMatchObject({ event_type: 'classification_rule_updated', entity_id: ID })
    })
  })

  describe('[id] DELETE', () => {
    it('soft-deletes by setting is_active=false and logs classification_rule_deactivated', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await DELETE(req('DELETE'), params())
      expect(res.status).toBe(200)
      expect(opArg(mock.queries, 'finance_classification_rules', 'update')).toMatchObject({ is_active: false })
      expect(events(mock.queries)[0]).toMatchObject({ event_type: 'classification_rule_deactivated', entity_id: ID })
    })

    it('is idempotent for an already-inactive rule (no update, no event)', async () => {
      const mock = db({ ...ROW, is_active: false })
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await DELETE(req('DELETE'), params())
      expect(res.status).toBe(200)
      expect(has(mock.queries.find(q => q.table === 'finance_classification_rules' && has(q, 'maybeSingle'))!, 'update')).toBe(false)
      expect(events(mock.queries)).toHaveLength(0)
    })
  })
})
