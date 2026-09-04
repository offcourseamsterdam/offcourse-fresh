import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'
import type { CockpitInputs } from '@/lib/finance/cockpit/types'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  materialize: vi.fn(),
  loadCockpitInputs: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/finance/cockpit/loans/materialize', () => ({ materializeLoanSchedule: h.materialize }))
vi.mock('@/lib/finance/cockpit/load-cockpit', () => ({ loadCockpitInputs: h.loadCockpitInputs }))

import { GET, POST } from './route'
import { POST as IMPACT } from './impact/route'

const L1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const L2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/loans'

const LOAN_BODY = {
  name: 'Investeerder A',
  lender_name: 'A. Investor',
  principal_cents: 10_000_000,
  interest_rate_pct: 5,
  duration_years: 10,
  interest_free_years: 0,
  repayment_type: 'linear',
  start_date: '2026-09-04',
}

const LOAN_ROW = { id: L1, ...LOAN_BODY, tranches: [], status: 'active', notes: null, created_at: '2026-09-04T00:00:00.000Z', updated_at: '2026-09-04T00:00:00.000Z' }

const PAYMENTS = [
  { loan_id: L1, due_date: '2026-10-01', interest_cents: 1_000, principal_cents: 50_000, total_cents: 51_000, is_paid: true },
  { loan_id: L1, due_date: '2027-04-01', interest_cents: 2_000, principal_cents: 50_000, total_cents: 52_000, is_paid: false },
  { loan_id: L1, due_date: '2027-10-01', interest_cents: 1_500, principal_cents: 50_000, total_cents: 51_500, is_paid: false },
]

const req = (method: string, body?: unknown, path = '') =>
  new NextRequest(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
const event = (queries: RecordedQuery[]) => opArg(queries, 'finance_events', 'insert') as Record<string, unknown>

describe('/api/admin/finance/cockpit/loans', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.materialize.mockResolvedValue({ loanId: L1, inserted: 20, updated: 0, deleted: 0, keptPaid: 0 })
  })

  describe('GET', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await GET()).status).toBe(401)
    })

    it('returns every loan with a summary computed from its payment rows', async () => {
      const mock = createSupabaseChainMock(q => {
        if (q.table === 'finance_loans') return { data: [LOAN_ROW, { ...LOAN_ROW, id: L2, name: 'Closed one', status: 'closed' }] }
        if (q.table === 'finance_loan_payments') return { data: PAYMENTS }
        return { data: null }
      })
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await GET()
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data).toHaveLength(2)
      expect(data[0].summary).toEqual({
        outstandingCents: 100_000,
        nextPayment: { due_date: '2027-04-01', total_cents: 52_000 },
        paidPeriods: 1,
        totalPeriods: 3,
        totalInterestCents: 4_500,
      })
      expect(data[1].summary).toEqual({ outstandingCents: 0, nextPayment: null, paidPeriods: 0, totalPeriods: 0, totalInterestCents: 0 })
    })
  })

  describe('POST', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 403 }))
      expect((await POST(req('POST', LOAN_BODY))).status).toBe(403)
    })

    it('rejects bad terms with 400 before touching the database', async () => {
      expect((await POST(req('POST', { ...LOAN_BODY, principal_cents: 0 }))).status).toBe(400)
      expect((await POST(req('POST', { ...LOAN_BODY, repayment_type: 'bullet' }))).status).toBe(400)
      expect((await POST(req('POST', { ...LOAN_BODY, interest_free_years: 11 }))).status).toBe(400)
      const mismatch = await POST(req('POST', { ...LOAN_BODY, tranches: [{ amount_cents: 1_000_000, date: '2026-09-04' }] }))
      expect(mismatch.status).toBe(400)
      expect((await mismatch.json()).error).toContain('Tranches must add up')
      expect(h.createAdminClient).not.toHaveBeenCalled()
    })

    it('inserts the loan, materialises its schedule and logs loan_created', async () => {
      const mock = createSupabaseChainMock(q => {
        if (q.table === 'finance_loans' && has(q, 'insert')) return { data: { ...LOAN_ROW, ...(op(q, 'insert')!.args[0] as object) } }
        return { data: null }
      })
      h.createAdminClient.mockReturnValue(mock.client)

      const tranches = [{ amount_cents: 6_000_000, date: '2026-09-04' }, { amount_cents: 4_000_000, date: '2026-12-01', note: 'tweede deel' }]
      const res = await POST(req('POST', { ...LOAN_BODY, tranches, notes: 'x' }))
      expect(res.status).toBe(201)
      const { data } = await res.json()
      expect(data.loan.id).toBe(L1)
      expect(data.schedule.inserted).toBe(20)

      expect(opArg(mock.queries, 'finance_loans', 'insert')).toMatchObject({ ...LOAN_BODY, tranches, notes: 'x', status: 'active' })
      expect(h.materialize).toHaveBeenCalledWith(mock.client, L1)
      expect(event(mock.queries)).toMatchObject({ event_type: 'loan_created', entity_type: 'loan', entity_id: L1, actor: 'user' })
    })

    it('rolls the loan back and returns 400 when the schedule engine rejects it', async () => {
      const mock = createSupabaseChainMock(q => {
        if (q.table === 'finance_loans' && has(q, 'insert')) return { data: LOAN_ROW }
        return { data: null }
      })
      h.createAdminClient.mockReturnValue(mock.client)
      h.materialize.mockRejectedValueOnce(new Error('Tranches (1) do not add up to the principal (2)'))

      const res = await POST(req('POST', LOAN_BODY))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('do not add up')
      const del = queriesFor(mock.queries, 'finance_loans', 'delete')[0]
      expect(op(del, 'eq')?.args).toEqual(['id', L1])
      expect(queriesFor(mock.queries, 'finance_events', 'insert')).toHaveLength(0)
    })
  })

  describe('impact', () => {
    const INPUTS: CockpitInputs = {
      today: '2026-09-04',
      horizon: '12m',
      cash: { clearedCents: 1_000_000, pendingOutCents: 0, pendingInCents: 0, source: 'manual', asOf: null },
      obligations: [
        { key: 'obl:x', title: 'BTW Q3', kind: 'tax', amountCents: 200_000, dueDate: '2026-10-31', source: 'obligation', sourceId: 'x', overdue: false, boatId: null },
      ],
      operationalCoverageCents: 0,
      ownerSalary: { monthlyCents: 0, months: 3, coverageCents: 0 },
      goals: [],
      safetyMarginCents: 500_000,
    }

    beforeEach(() => {
      h.loadCockpitInputs.mockResolvedValue({ inputs: INPUTS, settings: {} })
    })

    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await IMPACT(req('POST', LOAN_BODY))).status).toBe(401)
    })

    it('validates the terms like a real loan', async () => {
      expect((await IMPACT(req('POST', { ...LOAN_BODY, duration_years: 0 }))).status).toBe(400)
      expect(h.loadCockpitInputs).not.toHaveBeenCalled()
    })

    it('adds the proceeds to cash and the in-horizon repayments to obligations, without saving anything', async () => {
      const res = await IMPACT(req('POST', LOAN_BODY))
      expect(res.status).toBe(200)
      const { data } = await res.json()

      expect(h.loadCockpitInputs).toHaveBeenCalledWith({ horizon: undefined })
      expect(h.createAdminClient).not.toHaveBeenCalled()

      // Before: untouched inputs.
      expect(data.before.cash.clearedCents).toBe(1_000_000)
      expect(data.before.obligations).toHaveLength(1)

      // After: +€100k proceeds, and the two payment dates inside 12 months (1 Oct 2026, 1 Apr 2027).
      expect(data.after.cash.clearedCents).toBe(11_000_000)
      const loanOccs = data.after.obligations.filter((o: { source: string }) => o.source === 'loan')
      expect(loanOccs.map((o: { dueDate: string }) => o.dueDate)).toEqual(['2026-10-01', '2027-04-01'])
      expect(loanOccs[0].title).toContain('Investeerder A')
      expect(data.after.obligations).toHaveLength(3)
      // Existing obligation kept and list re-sorted by due date.
      expect(data.after.obligations.map((o: { dueDate: string }) => o.dueDate)).toEqual(['2026-10-01', '2026-10-31', '2027-04-01'])

      const [p0, p1] = data.schedulePreview
      expect(data.obligationsAddedInHorizonCents).toBe(p0.totalCents + p1.totalCents)
      expect(data.schedulePreview).toHaveLength(8)
      expect(data.endDate).toBe('2036-04-01')
      expect(data.totalInterestCents).toBeGreaterThan(0)
      expect(data.belowSafetyMargin).toBe(data.after.financialSpaceCents < data.after.safetyMarginCents)
      expect(data.belowSafetyMargin).toBe(false)
    })

    it('leaves cash alone when proceeds_received=false and honours the horizon override', async () => {
      h.loadCockpitInputs.mockResolvedValueOnce({ inputs: { ...INPUTS, horizon: '30d' }, settings: {} })
      const res = await IMPACT(req('POST', { ...LOAN_BODY, proceeds_received: false, horizon: '30d' }))
      const { data } = await res.json()
      expect(h.loadCockpitInputs).toHaveBeenCalledWith({ horizon: '30d' })
      expect(data.after.cash.clearedCents).toBe(1_000_000)
      // Only 1 Oct 2026 falls inside 30 days.
      expect(data.after.obligations.filter((o: { source: string }) => o.source === 'loan')).toHaveLength(1)
      expect(data.belowSafetyMargin).toBe(true)
    })
  })
})
