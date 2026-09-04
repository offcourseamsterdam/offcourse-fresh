import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, type RecordedQuery } from '@/test/supabase-chain-mock'

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

const SHIFT_ROWS = [
  { id: 'shift-1', staff_id: 'staff-1', boat_id: 'boat-1', date: '2026-08-15' },
  { id: 'shift-2', staff_id: 'staff-2', boat_id: 'boat-2', date: '2026-08-10' },
]
const STAFF_ROWS = [{ id: 'staff-1', name: 'Mare' }, { id: 'staff-2', name: 'Bas' }]
const BOAT_ROWS = [{ id: 'boat-1', name: 'Diana' }, { id: 'boat-2', name: 'Curaçao' }]

function db(opts: { shifts?: Record<string, unknown>[]; matchedShiftIds?: string[]; error?: { message: string } } = {}) {
  const shifts = opts.shifts ?? SHIFT_ROWS
  const matched = opts.matchedShiftIds ?? []
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (opts.error) return { data: null, error: opts.error }
    if (q.table === 'shifts') return { data: shifts }
    if (q.table === 'finance_invoices') return { data: matched.map(id => ({ matched_shift_id: id })) }
    if (q.table === 'staff') return { data: STAFF_ROWS }
    if (q.table === 'boats') return { data: BOAT_ROWS }
    return { data: [] }
  })
}

const req = () => new NextRequest('https://offcourseamsterdam.com/api/cron/finance-missing-invoices')

describe('GET /api/cron/finance-missing-invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireCronSecret.mockReturnValue(null)
  })

  it('passes the requireCronSecret denial through', async () => {
    h.requireCronSecret.mockReturnValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await GET(req())).status).toBe(401)
  })

  it('no old unassigned-invoice shifts at all → no Slack post', async () => {
    h.createAdminClient.mockReturnValue(db({ shifts: [] }).client)
    const res = await GET(req())
    expect(await res.json()).toEqual({ ok: true, missingCount: 0, checked: 0 })
    expect(h.postSlackOps).not.toHaveBeenCalled()
  })

  it('every candidate shift already has a matched invoice → no Slack post', async () => {
    h.createAdminClient.mockReturnValue(db({ matchedShiftIds: ['shift-1', 'shift-2'] }).client)
    const res = await GET(req())
    expect(await res.json()).toEqual({ ok: true, missingCount: 0, checked: 2 })
    expect(h.postSlackOps).not.toHaveBeenCalled()
  })

  it('posts one Slack DM listing every shift with no matched invoice', async () => {
    h.createAdminClient.mockReturnValue(db({ matchedShiftIds: ['shift-1'] }).client)
    const res = await GET(req())
    expect(await res.json()).toEqual({ ok: true, missingCount: 1, checked: 2 })
    expect(h.postSlackOps).toHaveBeenCalledTimes(1)
    const message = h.postSlackOps.mock.calls[0][0] as string
    expect(message).toContain('Bas — 2026-08-10 (Curaçao)')
    expect(message).not.toContain('Mare')
  })

  it('a shift with no staff match on file still gets a fallback label, never left blank', async () => {
    h.createAdminClient.mockReturnValue(
      db({ shifts: [{ id: 'shift-3', staff_id: 'staff-unknown', boat_id: null, date: '2026-08-01' }] }).client,
    )
    const res = await GET(req())
    expect((await res.json()).missingCount).toBe(1)
    expect(h.postSlackOps.mock.calls[0][0]).toContain('Onbekende skipper — 2026-08-01')
  })

  it('a DB error alerts the cron failure and returns 500, never throws unhandled', async () => {
    h.createAdminClient.mockReturnValue(db({ error: { message: 'connection refused' } }).client)
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(h.alertCronFailure).toHaveBeenCalledWith('finance-missing-invoices', expect.any(Error))
  })
})
