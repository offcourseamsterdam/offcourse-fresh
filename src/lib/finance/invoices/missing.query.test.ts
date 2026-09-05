import { describe, it, expect } from 'vitest'
import { createSupabaseChainMock, has, op, type RecordedQuery } from '@/test/supabase-chain-mock'
import { findShiftsMissingInvoices } from './missing'

const SHIFT_ROWS = [
  { id: 'shift-1', staff_id: 'staff-1', boat_id: 'boat-1', date: '2026-08-15' },
  { id: 'shift-2', staff_id: 'staff-2', boat_id: 'boat-2', date: '2026-08-10' },
]

function db(opts: { shifts?: Record<string, unknown>[]; matchedShiftIds?: string[] } = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'shifts') return { data: opts.shifts ?? SHIFT_ROWS }
    if (q.table === 'finance_invoices') return { data: (opts.matchedShiftIds ?? []).map(id => ({ matched_shift_id: id })) }
    return { data: [] }
  })
}

describe('findShiftsMissingInvoices', () => {
  it('returns every candidate in the scan window with hasInvoice flagged, not just the missing ones', async () => {
    const mock = db({ matchedShiftIds: ['shift-1'] })
    const rows = await findShiftsMissingInvoices(mock.client as never, '2026-09-04')
    expect(rows).toEqual([
      { id: 'shift-1', staffId: 'staff-1', boatId: 'boat-1', date: '2026-08-15', hasInvoice: true },
      { id: 'shift-2', staffId: 'staff-2', boatId: 'boat-2', date: '2026-08-10', hasInvoice: false },
    ])
  })

  it('scopes the shift query to staff_id set, not cancelled, older than the cutoff, and within the 90-day scan window', async () => {
    const mock = db()
    await findShiftsMissingInvoices(mock.client as never, '2026-09-04')
    const q = mock.queries.find(query => query.table === 'shifts')!
    expect(op(q, 'not')?.args).toEqual(['staff_id', 'is', null])
    expect(op(q, 'neq')?.args).toEqual(['status', 'cancelled'])
    expect(op(q, 'lt')?.args).toEqual(['date', '2026-08-21']) // 14-day lookback cutoff
    expect(op(q, 'gte')?.args).toEqual(['date', '2026-05-23']) // cutoff − 90 days
  })

  it('no candidate shifts at all → empty, no finance_invoices query issued', async () => {
    const mock = db({ shifts: [] })
    const rows = await findShiftsMissingInvoices(mock.client as never, '2026-09-04')
    expect(rows).toEqual([])
    expect(mock.queries.some(q => q.table === 'finance_invoices')).toBe(false)
  })

  it('propagates a shifts query error', async () => {
    const mock = createSupabaseChainMock((q: RecordedQuery) => (q.table === 'shifts' ? { data: null, error: { message: 'boom' } } : { data: [] }))
    await expect(findShiftsMissingInvoices(mock.client as never, '2026-09-04')).rejects.toThrow('boom')
  })

  it('propagates a finance_invoices query error', async () => {
    const mock = createSupabaseChainMock((q: RecordedQuery) => {
      if (q.table === 'shifts') return { data: SHIFT_ROWS }
      if (q.table === 'finance_invoices') return { data: null, error: { message: 'boom' } }
      return { data: [] }
    })
    await expect(findShiftsMissingInvoices(mock.client as never, '2026-09-04')).rejects.toThrow('boom')
  })
})
