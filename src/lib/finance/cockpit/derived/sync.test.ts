import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseChainMock, has, op, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({ logFinanceEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/finance/cockpit/events', () => ({ logFinanceEvent: h.logFinanceEvent }))

import { upsertDerivedObligation, type DerivedObligationProposal } from './sync'

function proposal(overrides: Partial<DerivedObligationProposal> = {}): DerivedObligationProposal {
  return {
    key: 'vat:2026-Q2',
    title: 'BTW 2026-Q2 (€1.150 hoog)',
    kind: 'tax',
    amountCents: 115_000,
    dueDate: '2026-08-31',
    notes: 'BTW-indicatie, automatisch berekend uit het kasboek',
    ...overrides,
  }
}

function db(opts: { existing?: { id: string; amount_cents: number; status: string } | null; insertError?: { code: string; message: string } } = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_obligations') {
      if (has(q, 'insert')) return opts.insertError ? { data: null, error: opts.insertError } : { data: { id: 'ob-new' } }
      // The update re-checks status='open' and returns the touched row(s).
      if (has(q, 'update')) return { data: opts.existing?.status === 'open' ? [{ id: opts.existing.id }] : [] }
      return { data: opts.existing ?? null }
    }
    return { data: null }
  })
}

describe('upsertDerivedObligation', () => {
  beforeEach(() => h.logFinanceEvent.mockClear())

  it('creates a new row when none exists, logging the given actor', async () => {
    const mock = db({ existing: null })
    const r = await upsertDerivedObligation(mock.client as never, proposal(), 'cron')
    expect(r).toEqual({ sourceKey: 'vat:2026-Q2', status: 'created', id: 'ob-new' })
    expect(op(mock.queries.find(q => has(q, 'insert'))!, 'insert')!.args[0]).toMatchObject({ kind: 'tax', amount_cents: 115_000, source_key: 'vat:2026-Q2', status: 'open' })
    expect(h.logFinanceEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'obligation_created', actor: 'cron' }))
  })

  it('a race on the unique source_key index is treated as already-created, not an error', async () => {
    const mock = db({ existing: null, insertError: { code: '23505', message: 'duplicate' } })
    const r = await upsertDerivedObligation(mock.client as never, proposal(), 'cron')
    expect(r).toEqual({ sourceKey: 'vat:2026-Q2', status: 'skipped', reason: 'already existed' })
  })

  it('an unchanged open row is left untouched — no write, no event', async () => {
    const mock = db({ existing: { id: 'ob-1', amount_cents: 115_000, status: 'open' } })
    const r = await upsertDerivedObligation(mock.client as never, proposal({ amountCents: 115_000 }), 'cron')
    expect(r).toEqual({ sourceKey: 'vat:2026-Q2', status: 'skipped', reason: 'ongewijzigd', id: 'ob-1' })
    expect(mock.queries.some(q => has(q, 'update'))).toBe(false)
    expect(h.logFinanceEvent).not.toHaveBeenCalled()
  })

  it('a running quarter\'s amount changing (e.g. the BTW indication updates as bookings come in) updates the row with the delta', async () => {
    const mock = db({ existing: { id: 'ob-1', amount_cents: 100_000, status: 'open' } })
    const r = await upsertDerivedObligation(mock.client as never, proposal({ amountCents: 115_000 }), 'cron')
    expect(r).toEqual({ sourceKey: 'vat:2026-Q2', status: 'updated', id: 'ob-1' })
    expect(op(mock.queries.find(q => has(q, 'update'))!, 'update')!.args[0]).toMatchObject({ amount_cents: 115_000 })
    expect(h.logFinanceEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ delta_cents: 15_000 }))
  })

  it('a row already paid or cancelled is never touched by a re-sync', async () => {
    const mock = db({ existing: { id: 'ob-1', amount_cents: 0, status: 'paid' } })
    const r = await upsertDerivedObligation(mock.client as never, proposal(), 'cron')
    expect(r.status).toBe('skipped')
    expect(mock.queries.some(q => has(q, 'update') || has(q, 'insert'))).toBe(false)
  })

  it('a manual confirm ("user") and the cron produce the identical insert payload, only the logged actor differs', async () => {
    const mockUser = db({ existing: null })
    const mockCron = db({ existing: null })
    await upsertDerivedObligation(mockUser.client as never, proposal(), 'user')
    await upsertDerivedObligation(mockCron.client as never, proposal(), 'cron')
    expect(op(mockUser.queries.find(q => has(q, 'insert'))!, 'insert')!.args[0]).toEqual(op(mockCron.queries.find(q => has(q, 'insert'))!, 'insert')!.args[0])
    expect(h.logFinanceEvent).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ actor: 'user' }))
    expect(h.logFinanceEvent).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ actor: 'cron' }))
  })

  it('a recurrenceMonths value is carried into the insert; omitting it defaults to null', async () => {
    const mock = db({ existing: null })
    await upsertDerivedObligation(mock.client as never, proposal({ key: 'recurring:x', recurrenceMonths: 3 }), 'cron')
    expect(op(mock.queries.find(q => has(q, 'insert'))!, 'insert')!.args[0]).toMatchObject({ recurrence_months: 3 })
  })
})
