import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdminOrFinanceShare: vi.fn(),
  createAdminClient: vi.fn(),
  uploadFinanceAttachment: vi.fn(),
}))
vi.mock('@/lib/auth/finance-share', () => ({ requireAdminOrFinanceShare: h.requireAdminOrFinanceShare }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/finance/attachment-storage', () => ({ uploadFinanceAttachment: h.uploadFinanceAttachment }))

import { GET, POST } from './route'

const BASE = 'https://offcourseamsterdam.com/api/admin/finance/vat-returns'
const OBLIGATION_ID = '11111111-1111-4111-8111-111111111111'

function db(opts: { obligation?: Record<string, unknown> | null; updateHitsZeroRows?: boolean } = {}) {
  const obligation = opts.obligation === undefined ? { id: OBLIGATION_ID, status: 'open', amount_cents: 180_423 } : opts.obligation
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_obligations') {
      // .select('id') after .update(...) returns an array of the rows actually touched —
      // empty when the .eq('status','open') re-check filtered the row out (lost the race).
      if (has(q, 'update')) return { data: opts.updateHitsZeroRows ? [] : obligation ? [{ id: obligation.id }] : [] }
      return { data: obligation }
    }
    if (q.table === 'finance_vat_returns') {
      if (has(q, 'upsert')) return { data: { id: 'vr-1', quarter: '2026-Q1', filed_date: '2026-04-30', net_cents: -3_485_500, obligation_id: obligation?.id ?? null } }
      return { data: [] }
    }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

function pdfFile(name = 'aangifte.pdf'): File {
  return new File(['%PDF-1.4 fake'], name, { type: 'application/pdf' })
}

function reqWith(fields: Record<string, string | null> = {}, file: File | null | undefined = pdfFile()): NextRequest {
  const form = new FormData()
  if (file) form.set('file', file)
  const defaults: Record<string, string> = {
    quarter: '2026-Q1',
    filedDate: '2026-04-30',
    direction: 'refund',
    amountCents: '3485500',
  }
  for (const [k, v] of Object.entries({ ...defaults, ...fields })) {
    if (v !== null) form.set(k, v)
  }
  return new NextRequest(BASE, { method: 'POST', body: form })
}

describe('/api/admin/finance/vat-returns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdminOrFinanceShare.mockResolvedValue(null)
    h.uploadFinanceAttachment.mockResolvedValue({ ok: true })
  })

  describe('GET', () => {
    it('passes the auth denial through', async () => {
      h.requireAdminOrFinanceShare.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await GET()).status).toBe(401)
    })

    it('lists filed returns ordered by quarter', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await GET()
      expect(res.status).toBe(200)
      expect((await res.json()).data).toEqual([]) // db() mock has no filed returns by default
      expect(mock.queries[0].table).toBe('finance_vat_returns')
      expect(op(mock.queries[0], 'order')?.args).toEqual(['quarter', { ascending: false }])
    })
  })

  describe('POST', () => {
    it('passes the auth denial through', async () => {
      h.requireAdminOrFinanceShare.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await POST(reqWith())).status).toBe(401)
    })

    it('rejects a missing or non-pdf file', async () => {
      expect((await POST(reqWith({}, null))).status).toBe(400)
      expect((await POST(reqWith({}, new File(['x'], 'aangifte.txt', { type: 'text/plain' })))).status).toBe(400)
    })

    it('rejects a malformed quarter, date or direction', async () => {
      expect((await POST(reqWith({ quarter: '2026Q1' }))).status).toBe(400)
      expect((await POST(reqWith({ filedDate: '30-04-2026' }))).status).toBe(400)
      expect((await POST(reqWith({ direction: 'sideways' }))).status).toBe(400)
      expect((await POST(reqWith({ amountCents: '-5' }))).status).toBe(400)
    })

    it('uploads to vat-returns/{quarter}.pdf and upserts the archive row', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await POST(reqWith())
      expect(res.status).toBe(200)
      expect(h.uploadFinanceAttachment).toHaveBeenCalledWith(expect.anything(), 'vat-returns/2026-Q1.pdf', expect.any(Buffer), 'application/pdf')
      expect(opArg(mock.queries, 'finance_vat_returns', 'upsert')).toMatchObject({
        quarter: '2026-Q1',
        filed_date: '2026-04-30',
        net_cents: -3_485_500,
        file_path: 'vat-returns/2026-Q1.pdf',
      })
    })

    it('closes a matching open obligation: real title, amount zeroed for a refund, status paid, two events logged with the real deltas', async () => {
      const mock = db() // obligation.amount_cents = 180_423 (the wrong prior indication)
      h.createAdminClient.mockReturnValue(mock.client)
      await POST(reqWith())

      const update = opArg(mock.queries, 'finance_obligations', 'update') as Record<string, unknown>
      expect(update.title).toBe('BTW 2026-Q1 — aangifte binnen: €34.855 terugontvangen')
      expect(update.amount_cents).toBe(0) // refund: nothing owed
      expect(update.status).toBe('paid')
      expect(update.paid_at).toEqual(expect.any(String))
      // The gap against the prior (wrong) auto-computed indication is derived server-side
      // from the obligation's own amount_cents, not trusted from the client.
      expect(update.notes).toContain('eerder automatisch berekende indicatie was €1.804 verschuldigd')
      expect(update.notes).toContain('wijkt af van de werkelijke aangifte')

      const events = queriesFor(mock.queries, 'finance_events', 'insert').map(q => op(q, 'insert')!.args[0] as Record<string, unknown>)
      const updated = events.find(e => e.event_type === 'obligation_updated')
      const paid = events.find(e => e.event_type === 'obligation_paid')
      expect(updated?.delta_cents).toBe(-180_423) // 0 - 180_423
      expect(paid?.delta_cents).toBe(0) // nothing actually paid — it was a refund
    })

    it('direction=owed closes the obligation with the REAL owed amount, not zero', async () => {
      const mock = db({ obligation: { id: OBLIGATION_ID, status: 'open', amount_cents: 50_000 } })
      h.createAdminClient.mockReturnValue(mock.client)
      await POST(reqWith({ direction: 'owed', amountCents: '150000' }))

      const update = opArg(mock.queries, 'finance_obligations', 'update') as Record<string, unknown>
      expect(update.amount_cents).toBe(150_000)

      const events = queriesFor(mock.queries, 'finance_events', 'insert').map(q => op(q, 'insert')!.args[0] as Record<string, unknown>)
      expect(events.find(e => e.event_type === 'obligation_paid')?.delta_cents).toBe(150_000)
    })

    it('a concurrent manual "Betaald" click between read and write wins — no obligation_paid event is logged for a write that never happened', async () => {
      const mock = db({ updateHitsZeroRows: true })
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await POST(reqWith())
      expect(res.status).toBe(200) // the archive row still saves
      expect(mock.queries.some(q => q.table === 'finance_events')).toBe(false)
    })

    it('an already-paid obligation gets its text corrected but is not re-marked / no second obligation_paid event', async () => {
      const mock = db({ obligation: { id: OBLIGATION_ID, status: 'paid', amount_cents: 0 } })
      h.createAdminClient.mockReturnValue(mock.client)
      await POST(reqWith())

      const update = opArg(mock.queries, 'finance_obligations', 'update') as Record<string, unknown>
      expect(update.status).toBeUndefined()
      expect(update.paid_at).toBeUndefined()
      expect(update.title).toContain('terugontvangen')

      const paidEvents = mock.queries.filter(q => q.table === 'finance_events')
      expect(paidEvents).toHaveLength(1) // only obligation_updated, no obligation_paid
    })

    it('a cancelled obligation is left untouched', async () => {
      const mock = db({ obligation: { id: OBLIGATION_ID, status: 'cancelled', amount_cents: 0 } })
      h.createAdminClient.mockReturnValue(mock.client)
      await POST(reqWith())
      expect(mock.queries.some(q => q.table === 'finance_obligations' && has(q, 'update'))).toBe(false)
      expect(mock.queries.some(q => q.table === 'finance_events')).toBe(false)
    })

    it('no matching obligation at all: still stores the archive row, obligation_id null', async () => {
      const mock = db({ obligation: null })
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await POST(reqWith())
      expect(res.status).toBe(200)
      expect(opArg(mock.queries, 'finance_vat_returns', 'upsert')).toMatchObject({ obligation_id: null })
    })

    it('direction=owed keeps net_cents positive', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      await POST(reqWith({ direction: 'owed', amountCents: '150000' }))
      expect(opArg(mock.queries, 'finance_vat_returns', 'upsert')).toMatchObject({ net_cents: 150_000 })
    })
  })
})
