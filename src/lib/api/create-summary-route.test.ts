import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  select: vi.fn(),
  fromSpy: vi.fn(),
}))

vi.mock('@/lib/auth/finance-share', () => ({ requireAdminOrFinanceShare: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      h.fromSpy(table)
      return { select: h.select }
    },
  }),
}))

import { createSummaryRoute } from './create-summary-route'

function mockReq(): NextRequest {
  return {} as unknown as NextRequest
}

interface TestRow {
  trip_date: string
  amount_cents: number
}

interface TestMapped {
  tripDate: string
  amountCents: number
}

interface TestSummary {
  total: number
  count: number
}

function makeRoute(aggregate = (rows: TestMapped[]): TestSummary => ({
  total: rows.reduce((sum, r) => sum + r.amountCents, 0),
  count: rows.length,
})) {
  return createSummaryRoute<TestRow, TestMapped, TestSummary>({
    table: 'barqo_bookings',
    columns: 'trip_date, amount_cents',
    map: (row) => ({ tripDate: row.trip_date, amountCents: row.amount_cents }),
    aggregate,
  })
}

describe('createSummaryRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('happy path: fetches rows, maps snake_case -> camelCase, aggregates, and returns apiOk', async () => {
    h.select.mockResolvedValue({
      data: [
        { trip_date: '2026-01-05', amount_cents: 1000 },
        { trip_date: '2026-02-10', amount_cents: 2500 },
      ],
      error: null,
    })

    const { GET } = makeRoute()
    const res = await GET(mockReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, data: { total: 3500, count: 2 } })
    expect(h.fromSpy).toHaveBeenCalledWith('barqo_bookings')
    expect(h.select).toHaveBeenCalledWith('trip_date, amount_cents')
  })

  it('treats a null data response as an empty row set (still calls aggregate)', async () => {
    h.select.mockResolvedValue({ data: null, error: null })

    const { GET } = makeRoute()
    const res = await GET(mockReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, data: { total: 0, count: 0 } })
  })

  it('Supabase error path: returns apiError with the DB error message, never calls aggregate', async () => {
    h.select.mockResolvedValue({ data: null, error: { message: 'relation "barqo_bookings" does not exist' } })
    const aggregate = vi.fn()

    const { GET } = makeRoute(aggregate)
    const res = await GET(mockReq())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ ok: false, error: 'relation "barqo_bookings" does not exist' })
    expect(aggregate).not.toHaveBeenCalled()
  })

  it('thrown-exception path: a rejected/throwing supabase call is caught and returns apiError with the Error message', async () => {
    h.select.mockRejectedValue(new Error('Supabase is down'))

    const { GET } = makeRoute()
    const res = await GET(mockReq())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ ok: false, error: 'Supabase is down' })
  })

  it('thrown-exception path: a non-Error throw still returns the generic "Unknown error" message', async () => {
    h.select.mockRejectedValue('string boom')

    const { GET } = makeRoute()
    const res = await GET(mockReq())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ ok: false, error: 'Unknown error' })
  })

  it('an exception thrown inside aggregate() itself is also caught by the same try/catch', async () => {
    h.select.mockResolvedValue({ data: [{ trip_date: '2026-01-05', amount_cents: 1000 }], error: null })
    const aggregate = vi.fn(() => {
      throw new Error('bad aggregate math')
    })

    const { GET } = makeRoute(aggregate)
    const res = await GET(mockReq())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ ok: false, error: 'bad aggregate math' })
  })

  it('auth-denied passthrough: returns requireAdmin\'s denial response unchanged and never touches Supabase', async () => {
    h.requireAdmin.mockResolvedValue(NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }))

    const { GET } = makeRoute()
    const res = await GET(mockReq())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({ ok: false, error: 'Forbidden' })
    expect(h.fromSpy).not.toHaveBeenCalled()
  })
})
