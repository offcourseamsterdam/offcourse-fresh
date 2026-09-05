import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireCronSecret: vi.fn(),
  createAdminClient: vi.fn(),
  postSlackOps: vi.fn().mockResolvedValue(undefined),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackOps: h.postSlackOps }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))

import { GET } from './route'

const STAFF_ID = '77777777-7777-4777-8777-777777777777'
const req = () => new NextRequest('https://offcourseamsterdam.com/api/cron/finance-sync-skipper-accrual')

// A shift squarely in a closed month (well before "today").
const CLOSED_SHIFT = { id: 's1', staff_id: STAFF_ID, date: '2026-07-10', start_at: '2026-07-10T10:00:00.000Z', end_at: '2026-07-10T14:00:00.000Z', status: 'completed' }
const STAFF = [{ id: STAFF_ID, name: 'Bo', hourly_rate_cents: 2_500, is_active: true }]

function db(opts: { shifts?: unknown[]; existing?: Record<string, unknown> | null; queryError?: { message: string } } = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (opts.queryError && q.table === 'shifts') return { data: null, error: opts.queryError }
    if (q.table === 'shifts') return { data: opts.shifts ?? [CLOSED_SHIFT] }
    if (q.table === 'time_entries') return { data: [] }
    if (q.table === 'extra_hours_bonuses') return { data: [] }
    if (q.table === 'review_bonuses') return { data: [] }
    if (q.table === 'staff') return { data: STAFF }
    if (q.table === 'finance_obligations') {
      if (has(q, 'insert')) return { data: { id: 'ob-new' } }
      if (has(q, 'update')) return { data: null }
      return { data: opts.existing === undefined ? null : opts.existing }
    }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

describe('GET /api/cron/finance-sync-skipper-accrual', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireCronSecret.mockReturnValue(null)
  })

  it('passes the requireCronSecret denial through', async () => {
    h.requireCronSecret.mockReturnValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await GET(req())).status).toBe(401)
  })

  it('a closed month with a real accrual is auto-created into an obligation, and Slack is notified', async () => {
    h.createAdminClient.mockReturnValue(db({ existing: null }).client)
    const res = await GET(req())
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, created: 1, updated: 0, blocked: 0 })
    expect(h.postSlackOps).toHaveBeenCalledTimes(1)
    expect(h.postSlackOps.mock.calls[0][0]).toContain('1 nieuwe verplichting')
  })

  it('nothing changed (already synced, same amount) → no Slack post, still 200', async () => {
    h.createAdminClient.mockReturnValue(db({ existing: { id: 'ob-1', amount_cents: 10_000, status: 'open' } }).client)
    const res = await GET(req())
    expect((await res.json()).ok).toBe(true)
    expect(h.postSlackOps).not.toHaveBeenCalled()
  })

  it('a skipper with no hourly rate is reported as blocked, never silently paid at zero', async () => {
    h.createAdminClient.mockReturnValue(
      db({ shifts: [CLOSED_SHIFT], existing: undefined }).client,
    )
    // Zero out the rate directly via a second mock — reuse db() but override staff.
    const mock = createSupabaseChainMock((q: RecordedQuery) => {
      if (q.table === 'shifts') return { data: [CLOSED_SHIFT] }
      if (q.table === 'time_entries') return { data: [] }
      if (q.table === 'extra_hours_bonuses') return { data: [] }
      if (q.table === 'review_bonuses') return { data: [] }
      if (q.table === 'staff') return { data: [{ id: STAFF_ID, name: 'Bo', hourly_rate_cents: 0, is_active: true }] }
      return { data: null }
    })
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET(req())
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, created: 0, blocked: 1 })
    expect(h.postSlackOps.mock.calls[0][0]).toContain('Zonder uurtarief')
    expect(h.postSlackOps.mock.calls[0][0]).toContain('Bo')
  })

  it('an open (not yet closed) month is never touched by the cron', async () => {
    const openShift = { id: 's2', staff_id: STAFF_ID, date: new Date().toISOString().slice(0, 10), start_at: `${new Date().toISOString().slice(0, 10)}T10:00:00.000Z`, end_at: `${new Date().toISOString().slice(0, 10)}T14:00:00.000Z`, status: 'completed' }
    h.createAdminClient.mockReturnValue(db({ shifts: [openShift] }).client)
    const res = await GET(req())
    const body = await res.json()
    expect(body.created).toBe(0)
    expect(h.postSlackOps).not.toHaveBeenCalled()
  })

  it('a DB error alerts the cron failure and returns 500', async () => {
    h.createAdminClient.mockReturnValue(db({ queryError: { message: 'connection refused' } }).client)
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(h.alertCronFailure).toHaveBeenCalledWith('finance-sync-skipper-accrual', expect.any(Error))
  })
})
