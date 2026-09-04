import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'
import type { CockpitInputs } from '@/lib/finance/cockpit/types'

const h = vi.hoisted(() => ({
  requireCronSecret: vi.fn(),
  createAdminClient: vi.fn(),
  postSlackOps: vi.fn().mockResolvedValue(undefined),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
  loadCockpitInputs: vi.fn(),
}))
vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackOps: h.postSlackOps }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))
vi.mock('@/lib/finance/cockpit/load-cockpit', () => ({ loadCockpitInputs: h.loadCockpitInputs }))

import { GET } from './route'

const BASE = 'https://offcourseamsterdam.com/api/cron/finance-monthly-allocation'

/** €20.000 cash, €5.000 margin, nothing else claimed → €15.000 above the margin. */
function inputs(over: Partial<CockpitInputs> = {}): CockpitInputs {
  return {
    today: '2026-09-04',
    horizon: '3m',
    cash: { clearedCents: 2_000_000, pendingOutCents: 0, pendingInCents: 0, source: 'manual', asOf: null },
    obligations: [],
    operationalCoverageCents: 0,
    ownerSalary: { monthlyCents: 0, months: 3, coverageCents: 0 },
    goals: [],
    safetyMarginCents: 500_000,
    ...over,
  }
}

function settingsRow(over: Record<string, unknown> = {}) {
  return {
    id: 'default',
    owner_salary_monthly_cents: 0,
    owner_salary_months: 3,
    owner_salary_coverage_cents: 0,
    allocation_priority: ['obligations', 'operational', 'owner_salary', 'goals'],
    ...over,
  }
}

const GOAL_ROW = {
  id: 'g1',
  name: 'Nieuwe motor',
  target_cents: 1_000_000,
  funded_cents: 0,
  deadline: null,
  priority: 1,
  monthly_funding_cents: 300_000,
  status: 'active',
  created_at: '2026-08-01T00:00:00.000Z',
  boat_id: null,
}

function db(opts: { alreadyRan?: boolean; goals?: Record<string, unknown>[]; goalUpdateRows?: unknown[]; settingsUpdateRows?: unknown[]; error?: string } = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (opts.error) return { data: null, error: { message: opts.error } }
    if (q.table === 'finance_events') {
      if (has(q, 'insert')) return { data: null }
      return { data: opts.alreadyRan ? [{ id: 'ev-1', occurred_at: '2026-09-01T06:00:00.000Z' }] : [] }
    }
    if (q.table === 'finance_goals') {
      if (has(q, 'update')) return { data: opts.goalUpdateRows ?? [{ id: 'g1' }] }
      return { data: opts.goals ?? [GOAL_ROW] }
    }
    if (q.table === 'finance_settings' && has(q, 'update')) return { data: opts.settingsUpdateRows ?? [{ id: 'default' }] }
    return { data: null }
  })
}

const req = (qs = '') => new NextRequest(`${BASE}${qs}`)

/** Events are asserted by type, never by position — the claim event's placement is an implementation detail. */
function findEvent(queries: RecordedQuery[], type: string): Record<string, unknown> | undefined {
  return queriesFor(queries, 'finance_events', 'insert')
    .map(q => op(q, 'insert')?.args[0] as Record<string, unknown>)
    .find(e => e?.event_type === type)
}

describe('GET /api/cron/finance-monthly-allocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireCronSecret.mockReturnValue(null)
    h.loadCockpitInputs.mockResolvedValue({ inputs: inputs(), settings: settingsRow() })
  })

  it('passes the requireCronSecret denial through', async () => {
    h.requireCronSecret.mockReturnValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await GET(req())).status).toBe(401)
  })

  it('allocates the monthly amount, writes an absolute value, and logs the funding event', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)

    const res = await GET(req())
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, availableCents: 1_500_000, allocatedCents: 300_000, deltas: 1, conflicts: [] })

    // Absolute write (fromCents + delta), not an increment, and guarded on the value it read.
    const update = queriesFor(mock.queries, 'finance_goals', 'update')[0]
    expect(op(update, 'update')?.args[0]).toEqual({ funded_cents: 300_000 })
    expect(update.ops.filter(o => o.method === 'eq').map(o => o.args)).toEqual([['id', 'g1'], ['funded_cents', 0]])

    const funding = findEvent(mock.queries, 'goal_funding_changed')
    expect(funding).toMatchObject({ actor: 'cron', entity_type: 'goal', entity_id: 'g1', delta_cents: 300_000 })
    expect(funding?.payload).toMatchObject({ before: 0, after: 300_000, reason: 'monthly_allocation', month: '2026-09' })
  })

  it('claims the month BEFORE moving money, and refuses to allocate if the claim fails', async () => {
    const mock = createSupabaseChainMock((q: RecordedQuery) => {
      if (q.table === 'finance_events') {
        if (has(q, 'insert')) return { data: null, error: { message: 'events table unavailable' } }
        return { data: [] }
      }
      if (q.table === 'finance_goals') return { data: has(q, 'update') ? [{ id: 'g1' }] : [GOAL_ROW] }
      return { data: null }
    })
    h.createAdminClient.mockReturnValue(mock.client)

    const res = await GET(req())
    expect(res.status).toBe(500)
    // The decisive assertion: not a cent moved.
    expect(queriesFor(mock.queries, 'finance_goals', 'update')).toHaveLength(0)
    expect(queriesFor(mock.queries, 'finance_settings', 'update')).toHaveLength(0)
    expect(h.alertCronFailure).toHaveBeenCalled()
  })

  it('the claim records what it intended to do, before doing it', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    await GET(req())

    const claim = findEvent(mock.queries, 'allocation_applied')
    expect(claim).toMatchObject({ actor: 'cron', entity_type: 'settings', delta_cents: 300_000 })
    expect(claim?.payload).toMatchObject({ month: '2026-09', availableCents: 1_500_000, plannedCents: 300_000 })

    // Claim first, money second.
    const order = mock.queries.map(q => `${q.table}:${q.ops[0]?.method}`)
    expect(order.indexOf('finance_events:insert')).toBeLessThan(order.indexOf('finance_goals:update'))
  })

  it('never allocates twice in the same month', async () => {
    const mock = db({ alreadyRan: true })
    h.createAdminClient.mockReturnValue(mock.client)

    const res = await GET(req())
    expect(await res.json()).toMatchObject({ ok: true, alreadyRan: true, allocatedCents: 0 })
    expect(queriesFor(mock.queries, 'finance_goals', 'update')).toHaveLength(0)
    expect(queriesFor(mock.queries, 'finance_events', 'insert')).toHaveLength(0)
    expect(h.postSlackOps).not.toHaveBeenCalled()
  })

  it('dryRun returns the plan and its Slack text without writing anything', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)

    const res = await GET(req('?dryRun=1'))
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.plan.allocatedCents).toBe(300_000)
    expect(body.summary).toContain('(proef)')

    expect(queriesFor(mock.queries, 'finance_goals', 'update')).toHaveLength(0)
    expect(queriesFor(mock.queries, 'finance_settings', 'update')).toHaveLength(0)
    expect(queriesFor(mock.queries, 'finance_events', 'insert')).toHaveLength(0)
    expect(h.postSlackOps).not.toHaveBeenCalled()
  })

  it('a goal edited between the read and the write is left alone and reported, never overwritten', async () => {
    const mock = db({ goalUpdateRows: [] }) // conditional update matched nothing
    h.createAdminClient.mockReturnValue(mock.client)

    const res = await GET(req())
    const body = await res.json()
    expect(body.conflicts).toEqual(['Nieuwe motor'])
    expect(body.allocatedCents).toBe(0)

    // No funding event for the row that didn't move, and the mismatch is recorded.
    expect(findEvent(mock.queries, 'goal_funding_changed')).toBeUndefined()
    expect(findEvent(mock.queries, 'allocation_conflicted')?.payload).toMatchObject({ plannedCents: 300_000, appliedCents: 0, conflicts: ['Nieuwe motor'] })
    expect(h.postSlackOps.mock.calls[0][0]).toContain('Tussentijds gewijzigd')
  })

  it('tops up the owner-salary buffer before goals and logs its own event', async () => {
    h.loadCockpitInputs.mockResolvedValue({
      inputs: inputs({ ownerSalary: { monthlyCents: 300_000, months: 3, coverageCents: 100_000 } }),
      settings: settingsRow({ owner_salary_monthly_cents: 300_000, owner_salary_months: 3, owner_salary_coverage_cents: 100_000 }),
    })
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)

    await GET(req())

    const settingsUpdate = queriesFor(mock.queries, 'finance_settings', 'update')[0]
    expect(op(settingsUpdate, 'update')?.args[0]).toEqual({ owner_salary_coverage_cents: 900_000 })
    expect(findEvent(mock.queries, 'owner_salary_coverage_changed')).toMatchObject({ entity_type: 'settings', delta_cents: 800_000 })
  })

  it('writes the month marker even when nothing was allocated, so a retry stays a no-op', async () => {
    h.loadCockpitInputs.mockResolvedValue({
      // Cash below the margin → no room at all.
      inputs: inputs({ cash: { clearedCents: 100_000, pendingOutCents: 0, pendingInCents: 0, source: 'manual', asOf: null } }),
      settings: settingsRow(),
    })
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)

    const res = await GET(req())
    expect((await res.json()).allocatedCents).toBe(0)

    const marker = findEvent(mock.queries, 'allocation_applied')
    expect(marker).toMatchObject({ actor: 'cron', delta_cents: 0 })
    expect((marker?.payload as Record<string, unknown>).month).toBe('2026-09')
  })

  it('never allocates more than the room above the safety margin', async () => {
    h.loadCockpitInputs.mockResolvedValue({
      // €6.000 cash, €5.000 margin → only €1.000 may move, though the goal wants €3.000.
      inputs: inputs({ cash: { clearedCents: 600_000, pendingOutCents: 0, pendingInCents: 0, source: 'manual', asOf: null } }),
      settings: settingsRow(),
    })
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)

    const res = await GET(req())
    const body = await res.json()
    expect(body.availableCents).toBe(100_000)
    expect(body.allocatedCents).toBe(100_000)
    expect(op(queriesFor(mock.queries, 'finance_goals', 'update')[0], 'update')?.args[0]).toEqual({ funded_cents: 100_000 })
  })

  it('a failure alerts and returns 500 rather than throwing', async () => {
    h.createAdminClient.mockReturnValue(db({ error: 'connection refused' }).client)
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(h.alertCronFailure).toHaveBeenCalledWith('finance-monthly-allocation', expect.any(Error))
  })
})
