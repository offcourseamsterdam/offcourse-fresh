import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, queriesFor } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET, PUT } from './route'

const BEFORE = {
  id: 'default',
  planning_horizon: '3m',
  safety_margin_cents: 2_000_000,
  operational_coverage_cents: 0,
  owner_salary_monthly_cents: 300_000,
  owner_salary_months: 3,
  owner_salary_coverage_cents: 100_000,
  manual_cash_cents: null,
  manual_cash_at: null,
  allocation_priority: ['obligations', 'operational', 'owner_salary', 'goals'],
  updated_at: '2026-09-01T00:00:00.000Z',
}

/** finance_settings reads return BEFORE; an update echoes the patch merged onto it. */
function db() {
  return createSupabaseChainMock(q => {
    if (q.table === 'finance_settings' && has(q, 'update')) return { data: { ...BEFORE, ...(op(q, 'update')!.args[0] as object) } }
    if (q.table === 'finance_settings') return { data: BEFORE }
    return { data: null }
  })
}

const put = (body: unknown) =>
  PUT(new NextRequest('https://offcourseamsterdam.com/api/admin/finance/cockpit/settings', { method: 'PUT', body: JSON.stringify(body) }))

describe('/api/admin/finance/cockpit/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('GET passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 403 }))
    expect((await GET()).status).toBe(403)
  })

  it('GET returns the settings row', async () => {
    h.createAdminClient.mockReturnValue(db().client)
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).data.safety_margin_cents).toBe(2_000_000)
  })

  it('PUT passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await put({ safety_margin_cents: 1 })).status).toBe(401)
    expect(h.createAdminClient).not.toHaveBeenCalled()
  })

  it('PUT rejects invalid values with 400', async () => {
    expect((await put({ owner_salary_months: 5 })).status).toBe(400)
    expect((await put({ safety_margin_cents: 12.5 })).status).toBe(400)
    expect((await put({ safety_margin_cents: -1 })).status).toBe(400)
    expect((await put({ planning_horizon: '6m' })).status).toBe(400)
    expect((await put({ allocation_priority: ['goals', 'goals', 'goals', 'goals'] })).status).toBe(400)
    expect((await put({ marketing_reserve_pct: -1 })).status).toBe(400)
    expect((await put({ marketing_reserve_pct: 101 })).status).toBe(400)
    expect((await put({ marketing_reserve_pct: 25.5 })).status).toBe(400)
    const empty = await put({})
    expect(empty.status).toBe(400)
    expect((await empty.json()).error).toContain('No settings fields')
    expect(h.createAdminClient).not.toHaveBeenCalled()
  })

  it('PUT accepts marketing_reserve_pct at its 0 and 100 boundaries', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    expect((await put({ marketing_reserve_pct: 0 })).status).toBe(200)
    expect((await put({ marketing_reserve_pct: 100 })).status).toBe(200)
  })

  it('PUT updates, stamps updated_at and logs a settings_updated event with the coverage delta', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)

    const res = await put({ owner_salary_coverage_cents: 250_000, planning_horizon: '12m' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.owner_salary_coverage_cents).toBe(250_000)
    expect(json.data.planning_horizon).toBe('12m')

    const update = opArg(mock.queries, 'finance_settings', 'update') as Record<string, unknown>
    expect(update.updated_at).toEqual(expect.any(String))
    expect(update).not.toHaveProperty('manual_cash_at')
    expect(op(queriesFor(mock.queries, 'finance_settings', 'update')[0], 'eq')?.args).toEqual(['id', 'default'])

    const event = opArg(mock.queries, 'finance_events', 'insert') as Record<string, unknown>
    expect(event).toMatchObject({
      event_type: 'settings_updated',
      actor: 'user',
      entity_type: 'settings',
      entity_id: null,
      delta_cents: 150_000,
    })
    const payload = event.payload as { changed: string[]; before: Record<string, unknown>; after: Record<string, unknown> }
    expect(payload.changed.sort()).toEqual(['owner_salary_coverage_cents', 'planning_horizon'])
    expect(payload.before.owner_salary_coverage_cents).toBe(100_000)
    expect(payload.after.planning_horizon).toBe('12m')
  })

  it('PUT stamps manual_cash_at when manual_cash_cents is set, and clears it on null', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)

    await put({ manual_cash_cents: 4_200_000 })
    const set = opArg(mock.queries, 'finance_settings', 'update') as Record<string, unknown>
    expect(set.manual_cash_cents).toBe(4_200_000)
    expect(set.manual_cash_at).toEqual(expect.any(String))
    expect((opArg(mock.queries, 'finance_events', 'insert') as { delta_cents: unknown }).delta_cents).toBeNull()

    await put({ manual_cash_cents: null })
    const cleared = opArg(mock.queries, 'finance_settings', 'update', 1) as Record<string, unknown>
    expect(cleared.manual_cash_cents).toBeNull()
    expect(cleared.manual_cash_at).toBeNull()
  })
})
