import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseChainMock, has, op, opArg, type RecordedQuery } from '@/test/supabase-chain-mock'
import type { InvoiceCheck } from './match'

const h = vi.hoisted(() => ({ logFinanceEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/finance/cockpit/events', () => ({ logFinanceEvent: h.logFinanceEvent }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { MAX_INVOICE_AMOUNT_CENTS, ensureInvoiceObligation, recordInvoiceDecision, resolvePayableAmount, supersedeCrewAccrual } from './decide'

const amountOk: InvoiceCheck = { key: 'amount', ok: true, detail: 'komt overeen' }
const amountBad: InvoiceCheck = { key: 'amount', ok: false, detail: 'Afgesproken €140,00, factuur €150,00' }
const noExpectation: InvoiceCheck = { key: 'amount', ok: false, detail: 'Geen verwacht bedrag te berekenen' }

const extracted = (amountCents: number | null) => ({ amountCents }) as never

describe('resolvePayableAmount — never pay an unchecked number', () => {
  it('uses the extracted amount when the amount check passed', () => {
    expect(resolvePayableAmount({ extracted: extracted(15000), expected_amount_cents: 15000, checks: [amountOk] })).toEqual({ ok: true, amountCents: 15000, source: 'extracted' })
  })

  it('falls back to hours × rate when the PDF disagrees with what we owe', () => {
    // Gemini read €150; the shift says €140. We pay €140, not the model's number.
    expect(resolvePayableAmount({ extracted: extracted(15000), expected_amount_cents: 14000, checks: [amountBad] })).toEqual({ ok: true, amountCents: 14000, source: 'expected' })
  })

  it('a typed amount wins over everything', () => {
    expect(resolvePayableAmount({ extracted: extracted(15000), expected_amount_cents: 14000, checks: [amountBad] }, 14250)).toEqual({ ok: true, amountCents: 14250, source: 'override' })
  })

  it('a non-skipper supplier (nothing to compute against) asks for confirmation with the extracted amount pre-filled', () => {
    const r = resolvePayableAmount({ extracted: extracted(8999), expected_amount_cents: null, checks: [noExpectation] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.suggestedCents).toBe(8999)
  })

  it('no amount anywhere → not ok, nothing suggested', () => {
    const r = resolvePayableAmount({ extracted: extracted(null), expected_amount_cents: null, checks: [] })
    expect(r).toMatchObject({ ok: false, suggestedCents: null })
  })

  it('an extracted amount without any amount check (extraction ran, matching never did) is not trusted blindly', () => {
    const r = resolvePayableAmount({ extracted: extracted(15000), expected_amount_cents: null, checks: [] })
    expect(r).toMatchObject({ ok: false, suggestedCents: 15000 })
  })

  it.each([0, -1, 12.5, MAX_INVOICE_AMOUNT_CENTS + 1])('rejects a typed amount out of range: %s', cents => {
    expect(resolvePayableAmount({ extracted: null, expected_amount_cents: null, checks: [] }, cents).ok).toBe(false)
  })

  it('a misread extracted amount above the ceiling is refused even when the check "passed"', () => {
    const r = resolvePayableAmount({ extracted: extracted(150_000_000), expected_amount_cents: 150_000_000, checks: [amountOk] })
    expect(r.ok).toBe(false)
  })
})

describe('ensureInvoiceObligation — exactly one per invoice', () => {
  it('inserts on first call', async () => {
    const mock = createSupabaseChainMock((q: RecordedQuery) => (has(q, 'insert') ? { data: { id: 'ob-1' } } : { data: null }))
    const r = await ensureInvoiceObligation(mock.client as never, { invoiceId: 'inv-1', title: 'Factuur Mare', amountCents: 100, dueDate: '2026-09-15', boatId: null })
    expect(r).toEqual({ id: 'ob-1', reused: false })
    expect(opArg(mock.queries, 'finance_obligations', 'insert')).toMatchObject({ invoice_id: 'inv-1', kind: 'invoice', status: 'open' })
  })

  it('a retry that hits the unique index reuses the existing row instead of deducting twice', async () => {
    const mock = createSupabaseChainMock((q: RecordedQuery) => {
      if (has(q, 'insert')) return { data: null, error: { message: 'duplicate key', code: '23505' } as never }
      return { data: { id: 'ob-existing' } }
    })
    const r = await ensureInvoiceObligation(mock.client as never, { invoiceId: 'inv-1', title: 't', amountCents: 100, dueDate: '2026-09-15', boatId: null })
    expect(r).toEqual({ id: 'ob-existing', reused: true })
  })

  it('any other insert error propagates', async () => {
    const mock = createSupabaseChainMock(() => ({ data: null, error: { message: 'boom', code: '42P01' } as never }))
    await expect(ensureInvoiceObligation(mock.client as never, { invoiceId: 'inv-1', title: 't', amountCents: 100, dueDate: '2026-09-15', boatId: null })).rejects.toThrow('boom')
  })
})

describe('recordInvoiceDecision — written once', () => {
  it('guards the update with decision IS NULL and returns the row', async () => {
    const mock = createSupabaseChainMock((q: RecordedQuery) => (has(q, 'update') ? { data: { id: 'inv-1', decision: 'approved' } } : { data: null }))
    const row = await recordInvoiceDecision(mock.client as never, 'inv-1', { status: 'approved', decision: 'approved', decision_note: null, obligation_id: 'ob-1' })
    expect(row).toMatchObject({ decision: 'approved' })
    const q = mock.queries.find(q => q.table === 'finance_invoices')!
    expect(op(q, 'is')!.args).toEqual(['decision', null])
    expect(op(q, 'eq')!.args).toEqual(['id', 'inv-1'])
  })

  it('returns null when another request already decided (zero rows matched)', async () => {
    const mock = createSupabaseChainMock(() => ({ data: null }))
    const row = await recordInvoiceDecision(mock.client as never, 'inv-1', { status: 'approved', decision: 'approved', decision_note: null, obligation_id: 'ob-1' })
    expect(row).toBeNull()
  })
})

describe('supersedeCrewAccrual — the invoice comes off the month accrual', () => {
  beforeEach(() => h.logFinanceEvent.mockClear())

  function db(accrual: { id: string; amount_cents: number; notes: string | null } | null, shift: { staff_id: string | null; date: string } | null = { staff_id: 'staff-1', date: '2026-08-14' }) {
    return createSupabaseChainMock((q: RecordedQuery) => {
      if (q.table === 'shifts') return { data: shift }
      if (q.table === 'finance_obligations' && has(q, 'update')) return { data: null }
      if (q.table === 'finance_obligations') return { data: accrual }
      return { data: null }
    })
  }

  it('no matched shift → nothing to supersede', async () => {
    const mock = db({ id: 'crew-1', amount_cents: 50000, notes: null })
    expect(await supersedeCrewAccrual(mock.client as never, { invoiceId: 'inv-1', matchedShiftId: null, amountCents: 100 })).toBeNull()
    expect(mock.queries).toHaveLength(0)
  })

  it('one invoice for one of several shifts REDUCES the month accrual, never cancels it outright', async () => {
    const mock = db({ id: 'crew-1', amount_cents: 50000, notes: 'Automatisch berekend' })
    const r = await supersedeCrewAccrual(mock.client as never, { invoiceId: 'inv-1', matchedShiftId: 'shift-1', amountCents: 14000 })
    expect(r).toEqual({ obligationId: 'crew-1', sourceKey: 'skipper-hours:2026-08:staff-1', remainingCents: 36000, cancelled: false })
    const update = opArg(mock.queries, 'finance_obligations', 'update') as Record<string, unknown>
    expect(update).toMatchObject({ amount_cents: 36000, status: 'open' })
    expect(String(update.notes)).toContain('Automatisch berekend')
    expect(String(update.notes)).toContain('inv-1')
    expect(h.logFinanceEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'obligation_updated', delta_cents: -14000 }))
  })

  it('the last invoice of the month cancels the accrual', async () => {
    const mock = db({ id: 'crew-1', amount_cents: 14000, notes: null })
    const r = await supersedeCrewAccrual(mock.client as never, { invoiceId: 'inv-2', matchedShiftId: 'shift-1', amountCents: 14000 })
    expect(r).toMatchObject({ remainingCents: 0, cancelled: true })
    expect(opArg(mock.queries, 'finance_obligations', 'update')).toMatchObject({ amount_cents: 0, status: 'cancelled' })
    expect(h.logFinanceEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'obligation_cancelled' }))
  })

  it('an invoice larger than what is left never drives the accrual negative', async () => {
    const mock = db({ id: 'crew-1', amount_cents: 10000, notes: null })
    const r = await supersedeCrewAccrual(mock.client as never, { invoiceId: 'inv-3', matchedShiftId: 'shift-1', amountCents: 14000 })
    expect(r).toMatchObject({ remainingCents: 0, cancelled: true })
    expect(h.logFinanceEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ delta_cents: -10000 }))
  })

  it('no open accrual for that skipper-month → null, no writes', async () => {
    const mock = db(null)
    expect(await supersedeCrewAccrual(mock.client as never, { invoiceId: 'inv-1', matchedShiftId: 'shift-1', amountCents: 100 })).toBeNull()
    expect(mock.queries.some(q => q.table === 'finance_obligations' && has(q, 'update'))).toBe(false)
  })

  it('a shift without a skipper assigned → null', async () => {
    const mock = db({ id: 'crew-1', amount_cents: 10000, notes: null }, { staff_id: null, date: '2026-08-14' })
    expect(await supersedeCrewAccrual(mock.client as never, { invoiceId: 'inv-1', matchedShiftId: 'shift-1', amountCents: 100 })).toBeNull()
  })
})
