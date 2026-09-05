import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseChainMock, has, op, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({ logFinanceEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/finance/cockpit/events', () => ({ logFinanceEvent: h.logFinanceEvent }))

import { upsertSkipperAccrualObligation } from './shared'
import type { SkipperMonthAccrual } from '@/lib/finance/cockpit/derived/skipper-hours'

const STAFF_ID = '77777777-7777-4777-8777-777777777777'

function accrual(overrides: Partial<SkipperMonthAccrual> = {}): SkipperMonthAccrual {
  return {
    key: `skipper:2026-08:${STAFF_ID}`,
    month: '2026-08',
    staffId: STAFF_ID,
    staffName: 'Bo',
    hours: 4,
    hourlyCostCents: 10_000,
    bonusCents: 0,
    amountCents: 10_000,
    shiftsCounted: 1,
    timeEntriesCounted: 0,
    isClosed: true,
    dueDate: '2026-09-07',
    unpricedHours: 0,
    ...overrides,
  }
}

function db(opts: { existing?: { id: string; amount_cents: number; status: string } | null; insertError?: { code: string; message: string } } = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_obligations') {
      if (has(q, 'insert')) return opts.insertError ? { data: null, error: opts.insertError } : { data: { id: 'ob-new' } }
      if (has(q, 'update')) return { data: null }
      return { data: opts.existing ?? null } // the pre-check select
    }
    return { data: null }
  })
}

describe('upsertSkipperAccrualObligation', () => {
  beforeEach(() => h.logFinanceEvent.mockClear())

  it('unpriced hours are never paid at zero, whether the caller is a human or the cron', async () => {
    const mock = db()
    const r = await upsertSkipperAccrualObligation(mock.client as never, accrual({ unpricedHours: 2, amountCents: 0 }), 'cron')
    expect(r).toMatchObject({ status: 'skipped', reason: expect.stringContaining('zonder uurtarief') })
    expect(mock.queries).toHaveLength(0)
  })

  it('creates a new obligation when none exists yet, logging the actor it was given', async () => {
    const mock = db({ existing: null })
    const r = await upsertSkipperAccrualObligation(mock.client as never, accrual(), 'cron')
    expect(r).toEqual({ sourceKey: `skipper-hours:2026-08:${STAFF_ID}`, status: 'created', id: 'ob-new' })
    expect(op(mock.queries.find(q => has(q, 'insert'))!, 'insert')!.args[0]).toMatchObject({ kind: 'crew', amount_cents: 10_000, status: 'open' })
    expect(h.logFinanceEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'obligation_created', actor: 'cron' }))
  })

  it('a race with another insert (23505) is treated as already-created, not an error', async () => {
    const mock = db({ existing: null, insertError: { code: '23505', message: 'duplicate' } })
    const r = await upsertSkipperAccrualObligation(mock.client as never, accrual(), 'cron')
    expect(r).toEqual({ sourceKey: `skipper-hours:2026-08:${STAFF_ID}`, status: 'skipped', reason: 'already existed' })
  })

  it('an existing open row with the same amount is left untouched — no update, no event', async () => {
    const mock = db({ existing: { id: 'ob-1', amount_cents: 10_000, status: 'open' } })
    const r = await upsertSkipperAccrualObligation(mock.client as never, accrual({ amountCents: 10_000 }), 'cron')
    expect(r).toEqual({ sourceKey: `skipper-hours:2026-08:${STAFF_ID}`, status: 'skipped', reason: 'ongewijzigd', id: 'ob-1' })
    expect(mock.queries.some(q => has(q, 'update'))).toBe(false)
    expect(h.logFinanceEvent).not.toHaveBeenCalled()
  })

  it('an existing open row with a changed amount (a corrected shift) is updated, and the event carries the delta', async () => {
    const mock = db({ existing: { id: 'ob-1', amount_cents: 8_000, status: 'open' } })
    const r = await upsertSkipperAccrualObligation(mock.client as never, accrual({ amountCents: 10_000 }), 'cron')
    expect(r).toEqual({ sourceKey: `skipper-hours:2026-08:${STAFF_ID}`, status: 'updated', id: 'ob-1' })
    const update = op(mock.queries.find(q => has(q, 'update'))!, 'update')!.args[0] as Record<string, unknown>
    expect(update).toMatchObject({ amount_cents: 10_000 })
    expect(h.logFinanceEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ delta_cents: 2_000 }))
  })

  it('a row an approved invoice already reduced/cancelled is never touched by the auto-sync', async () => {
    const mock = db({ existing: { id: 'ob-1', amount_cents: 0, status: 'cancelled' } })
    const r = await upsertSkipperAccrualObligation(mock.client as never, accrual(), 'cron')
    expect(r.status).toBe('skipped')
    expect(mock.queries.some(q => has(q, 'update') || has(q, 'insert'))).toBe(false)
  })

  it('a manual confirm and the cron produce the exact same row shape — only the logged actor differs', async () => {
    const mockUser = db({ existing: null })
    const mockCron = db({ existing: null })
    const rUser = await upsertSkipperAccrualObligation(mockUser.client as never, accrual(), 'user')
    const rCron = await upsertSkipperAccrualObligation(mockCron.client as never, accrual(), 'cron')
    expect(rUser.status).toBe(rCron.status)
    expect(op(mockUser.queries.find(q => has(q, 'insert'))!, 'insert')!.args[0]).toEqual(op(mockCron.queries.find(q => has(q, 'insert'))!, 'insert')!.args[0])
  })
})
