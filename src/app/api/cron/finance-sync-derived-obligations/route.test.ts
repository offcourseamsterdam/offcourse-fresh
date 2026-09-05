import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireCronSecret: vi.fn(),
  createAdminClient: vi.fn(),
  postSlackOps: vi.fn().mockResolvedValue(undefined),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
  computeBtwDashboard: vi.fn(),
}))
vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackOps: h.postSlackOps }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))
vi.mock('@/lib/finance/btw-dashboard-calculator', () => ({ computeBtwDashboard: h.computeBtwDashboard }))

import { GET } from './route'

const req = () => new NextRequest('https://offcourseamsterdam.com/api/cron/finance-sync-derived-obligations')

function db(opts: { bookings?: unknown[]; bankTx?: unknown[]; existingTitles?: { title: string }[]; queryError?: { message: string } } = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (opts.queryError && q.table === 'bookings') return { data: null, error: opts.queryError }
    if (q.table === 'bookings') return { data: opts.bookings ?? [] }
    if (q.table === 'bank_transactions') return { data: opts.bankTx ?? [] }
    if (q.table === 'finance_obligations') {
      if (has(q, 'insert')) return { data: { id: 'ob-new' } }
      if (has(q, 'update')) return { data: null }
      if (has(q, 'eq')) return { data: null } // upsertDerivedObligation's pre-check
      return { data: opts.existingTitles ?? [] } // recurring's existing-titles listing
    }
    return { data: null }
  })
}

describe('GET /api/cron/finance-sync-derived-obligations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireCronSecret.mockReturnValue(null)
    h.computeBtwDashboard.mockResolvedValue({ quarters: [] })
  })

  it('passes the requireCronSecret denial through', async () => {
    h.requireCronSecret.mockReturnValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await GET(req())).status).toBe(401)
  })

  it('nothing owed anywhere → 200, nothing created, no Slack post', async () => {
    h.createAdminClient.mockReturnValue(db().client)
    const res = await GET(req())
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, created: 0, updated: 0 })
    expect(h.postSlackOps).not.toHaveBeenCalled()
  })

  it('a real BTW quarter owing money is synced into an obligation, and Slack is notified', async () => {
    h.computeBtwDashboard.mockResolvedValue({
      quarters: [{ quarter: '2026-Q2', netIndicationCents: 115_000, vat9OwedCents: 0, vat21OwedCents: 115_000, vat21DeductibleCents: 0 }],
    })
    h.createAdminClient.mockReturnValue(db().client)
    const res = await GET(req())
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, created: 1 })
    expect(h.postSlackOps).toHaveBeenCalledTimes(1)
    expect(h.postSlackOps.mock.calls[0][0]).toContain('1 nieuw')
  })

  it('a net-refund BTW quarter is never proposed, so never synced', async () => {
    h.computeBtwDashboard.mockResolvedValue({ quarters: [{ quarter: '2026-Q1', netIndicationCents: -5_000, vat9OwedCents: 0, vat21OwedCents: 0, vat21DeductibleCents: 5_000 }] })
    h.createAdminClient.mockReturnValue(db().client)
    const res = await GET(req())
    expect((await res.json()).created).toBe(0)
  })

  it('a detected standing charge is synced with kind \'other\' — the detector has no signal to classify it further', async () => {
    const rows = ['2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05'].map((d, i) => ({
      id: `tx-${i}`, amount_cents: -12_000, created_at: `${d}T10:00:00.000Z`, merchant: { name: 'Schepenverzekering B.V.' }, counterparty: null, description: null, category: null, subcategory: null,
    }))
    h.createAdminClient.mockReturnValue(db({ bankTx: rows }).client)
    const res = await GET(req())
    const body = await res.json()
    expect(body.created).toBe(1)
  })

  it('nothing changed on a re-run (already synced, same amount) → no Slack post', async () => {
    h.computeBtwDashboard.mockResolvedValue({ quarters: [{ quarter: '2026-Q2', netIndicationCents: 115_000, vat9OwedCents: 0, vat21OwedCents: 115_000, vat21DeductibleCents: 0 }] })
    const mock = createSupabaseChainMock((q: RecordedQuery) => {
      if (q.table === 'bookings') return { data: [] }
      if (q.table === 'bank_transactions') return { data: [] }
      if (q.table === 'finance_obligations') {
        if (has(q, 'insert') || has(q, 'update')) return { data: null }
        if (has(q, 'eq')) return { data: { id: 'ob-1', amount_cents: 115_000, status: 'open' } }
        return { data: [] }
      }
      return { data: null }
    })
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET(req())
    const body = await res.json()
    expect(body).toMatchObject({ created: 0, updated: 0 })
    expect(h.postSlackOps).not.toHaveBeenCalled()
  })

  it('a DB error alerts the cron failure and returns 500', async () => {
    h.createAdminClient.mockReturnValue(db({ queryError: { message: 'connection refused' } }).client)
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(h.alertCronFailure).toHaveBeenCalledWith('finance-sync-derived-obligations', expect.any(Error))
  })
})
