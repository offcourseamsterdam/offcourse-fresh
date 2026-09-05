import { describe, it, expect, vi } from 'vitest'
import { createSupabaseChainMock, has, type RecordedQuery } from '@/test/supabase-chain-mock'
import { loadInsights } from './load-cockpit'
import type { CockpitResult } from './types'

// Only the fields buildInsights()/loadInsights() actually read.
function cockpit(overrides: Partial<CockpitResult> = {}): CockpitResult {
  return {
    today: '2026-09-04',
    horizon: '3m',
    horizonEnd: '2026-12-04',
    cash: { clearedCents: 500000, pendingOutCents: 0, pendingInCents: 0, source: 'revolut', asOf: '2026-09-04T10:00:00Z' },
    buckets: [],
    requiredCents: 0,
    freeCents: 500000,
    financialSpaceCents: 500000,
    safetyMarginCents: 2000000,
    availableForGrowthCents: 0,
    marginShortfallCents: 1500000,
    reserveOverrunCents: 0,
    ownerSalary: { monthlyCents: 0, targetMonths: 3, targetCents: 0, coverageCents: 0, monthsCovered: 0 },
    obligations: [],
    goals: [],
    status: { level: 'attention', label: 'Let op', reasons: [] },
    why: [],
    ...overrides,
  }
}

const CONNECTED = { account_id: 'acct-1', last_sync_at: '2026-09-04T10:00:00.000Z', last_sync_error: null }

function db(opts: {
  conn?: Record<string, unknown> | null
  snapshotBalanceCents?: number
  lastTxBalanceAfterCents?: number | null
  unclassifiedCount?: number
  needsReviewRows?: { amount_cents: number }[]
  shifts?: Record<string, unknown>[]
} = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'revolut_connection') return { data: opts.conn === undefined ? CONNECTED : opts.conn }
    if (q.table === 'revolut_balance_snapshots') return { data: { balance_cents: opts.snapshotBalanceCents ?? 500000 } }
    if (q.table === 'bank_transactions') {
      if (has(q, 'is')) return { data: [], count: opts.unclassifiedCount ?? 0 } // unclassified count query
      if (has(q, 'eq') && q.ops.some(o => o.method === 'eq' && o.args[0] === 'needs_review')) return { data: opts.needsReviewRows ?? [] }
      // the reconciliation "last completed transaction" lookup
      return { data: opts.lastTxBalanceAfterCents === undefined ? { balance_after_cents: 500000 } : opts.lastTxBalanceAfterCents == null ? null : { balance_after_cents: opts.lastTxBalanceAfterCents } }
    }
    if (q.table === 'shifts') return { data: opts.shifts ?? [] }
    if (q.table === 'finance_invoices') return { data: [] }
    return { data: null }
  })
}

describe('loadInsights', () => {
  it('a matching balance and last-transaction balance produce no reconciliation insight', async () => {
    const mock = db({ snapshotBalanceCents: 500000, lastTxBalanceAfterCents: 500000 })
    const insights = await loadInsights(mock.client as never, cockpit())
    expect(insights.find(i => i.key === 'reconciliation-gap')).toBeUndefined()
  })

  it('a mismatch between the bank balance and the last transaction\'s own balance surfaces as a critical insight, in euros', async () => {
    const mock = db({ snapshotBalanceCents: 502000, lastTxBalanceAfterCents: 500000 })
    const insights = await loadInsights(mock.client as never, cockpit())
    const gap = insights.find(i => i.key === 'reconciliation-gap')
    expect(gap).toBeDefined()
    expect(gap?.level).toBe('critical')
    expect(gap?.message).toContain('€20')
  })

  it('no Revolut connection at all → no reconciliation check attempted, no crash', async () => {
    const mock = db({ conn: null })
    const insights = await loadInsights(mock.client as never, cockpit())
    expect(insights.find(i => i.key === 'reconciliation-gap')).toBeUndefined()
    expect(mock.queries.some(q => q.table === 'revolut_balance_snapshots')).toBe(false)
  })

  it('a connection with no completed transaction yet (brand new) has nothing to reconcile against', async () => {
    const mock = db({ lastTxBalanceAfterCents: null })
    const insights = await loadInsights(mock.client as never, cockpit())
    expect(insights.find(i => i.key === 'reconciliation-gap')).toBeUndefined()
  })

  it('the "last completed transaction" lookup excludes a null completed_at, so it can never outrank a real one under Postgres\' NULLS FIRST default', async () => {
    const mock = db()
    await loadInsights(mock.client as never, cockpit())
    const lookup = mock.queries.find(q => q.table === 'bank_transactions' && q.ops.some(o => o.method === 'order' && o.args[0] === 'completed_at'))!
    const notCalls = lookup.ops.filter(o => o.method === 'not').map(o => o.args)
    expect(notCalls).toContainEqual(['completed_at', 'is', null])
    expect(notCalls).toContainEqual(['balance_after_cents', 'is', null])
  })

  it('a stored sync error is surfaced', async () => {
    const mock = db({ conn: { ...CONNECTED, last_sync_error: 'token expired' } })
    const insights = await loadInsights(mock.client as never, cockpit())
    expect(insights.find(i => i.key === 'sync-error')?.message).toContain('token expired')
  })

  it('unreviewed transactions are counted, and the largest one is reported', async () => {
    const mock = db({ needsReviewRows: [{ amount_cents: -12000 }, { amount_cents: 600000 }] })
    const insights = await loadInsights(mock.client as never, cockpit())
    const needsReview = insights.find(i => i.key === 'needs-review')
    expect(needsReview?.message).toContain('2 transacties')
    expect(needsReview?.message).toContain('6.000') // the largest absolute amount, not the first row
  })

  it('a shift missing an invoice is counted only when it has no matched invoice', async () => {
    const mock = db({
      shifts: [
        { id: 's1', staff_id: 'staff-1', boat_id: null, date: '2026-08-01' },
        { id: 's2', staff_id: 'staff-2', boat_id: null, date: '2026-08-02' },
      ],
    })
    const insights = await loadInsights(mock.client as never, cockpit())
    expect(insights.find(i => i.key === 'missing-skipper-invoices')?.message).toContain('2 gevaren tochten')
  })

  it('when everything is healthy and covered, the only insight is the positive one', async () => {
    const mock = db()
    const insights = await loadInsights(mock.client as never, cockpit({ status: { level: 'healthy', label: 'Financieel gezond', reasons: [] }, availableForGrowthCents: 250000, marginShortfallCents: 0 }))
    expect(insights).toEqual([{ key: 'available-for-growth', level: 'info', message: expect.stringContaining('beschikbaar voor groei'), href: '/finance/investments' }])
  })
})

describe('loadCockpit — insights never break the dashboard', () => {
  it('a thrown error while loading insights degrades to an empty list, not a failed request', async () => {
    vi.resetModules()
    vi.doMock('@/lib/finance/invoices/missing', () => ({
      findShiftsMissingInvoices: vi.fn().mockRejectedValue(new Error('bank_transactions unreachable')),
    }))
    const { loadCockpit } = await import('./load-cockpit')
    const mock = createSupabaseChainMock((q: RecordedQuery) => {
      if (q.table === 'finance_settings') {
        return {
          data: {
            id: 'default', planning_horizon: '3m', safety_margin_cents: 2000000, operational_coverage_cents: 0,
            owner_salary_monthly_cents: 0, owner_salary_months: 3, owner_salary_coverage_cents: 0,
            manual_cash_cents: 500000, manual_cash_at: '2026-09-01', allocation_priority: null,
          },
        }
      }
      if (q.table === 'revolut_connection') return { data: null }
      return { data: [] }
    })
    const result = await loadCockpit({ supabase: mock.client as never, today: '2026-09-04' })
    expect(result.insights).toEqual([])
    vi.doUnmock('@/lib/finance/invoices/missing')
    vi.resetModules()
  })
})
