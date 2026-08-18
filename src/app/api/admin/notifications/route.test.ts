import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * The notification feed is admin-only because every logged message can carry
 * customer names, emails, phone numbers and Stripe payment intent ids. These tests
 * cover the auth gate, the window/limit clamping (an unbounded `days` would scan
 * the whole table), and the counts being computed over the window rather than over
 * the truncated page.
 */

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  feedRows: [] as unknown[],
  windowRows: [] as unknown[],
  feedGte: vi.fn(),
  countGte: vi.fn(),
  feedLimit: vi.fn(),
  eqSpy: vi.fn(),
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: (cols: string) => {
        // The feed query selects the full row; the counts query selects 'kind, status'.
        const isCounts = cols === 'kind, status'
        if (isCounts) {
          return {
            gte: (_c: string, since: string) => {
              h.countGte(since)
              return { limit: () => Promise.resolve({ data: h.windowRows, error: null }) }
            },
          }
        }
        const feed = {
          gte: (_c: string, since: string) => { h.feedGte(since); return feed },
          order: () => feed,
          limit: (n: number) => { h.feedLimit(n); return feed },
          eq: (_c: string, v: string) => { h.eqSpy(v); return feed },
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: h.feedRows, error: null }),
        }
        return feed
      },
    }),
  }),
}))

import { GET } from './route'

function mockReq(query = ''): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/admin/notifications${query}`) } as unknown as NextRequest
}

function row(kind: string, status = 'sent') {
  return {
    id: `id-${kind}-${status}`,
    created_at: '2026-08-18T10:00:00.000Z',
    kind,
    destination: 'channel',
    channel: null,
    text: 'hello',
    status,
    error: null,
  }
}

describe('GET /api/admin/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.feedRows = [row('booking.created')]
    h.windowRows = [row('booking.created'), row('booking.created'), row('cron.failed', 'failed')]
  })

  it('refuses when requireAdmin denies', async () => {
    const denied = new Response('nope', { status: 401 })
    h.requireAdmin.mockResolvedValue(denied)

    const res = await GET(mockReq())

    expect(res).toBe(denied)
    expect(h.feedGte).not.toHaveBeenCalled()
  })

  it('defaults to a 7-day window and a 100-row page', async () => {
    const res = await GET(mockReq())
    const json = await res.json()

    expect(json.data.days).toBe(7)
    expect(h.feedLimit).toHaveBeenCalledWith(100)
  })

  it('clamps days and limit to sane bounds', async () => {
    await GET(mockReq('?days=9999&limit=99999'))
    expect(h.feedLimit).toHaveBeenCalledWith(500)

    const res = await GET(mockReq('?days=9999'))
    expect((await res.json()).data.days).toBe(90)

    const res2 = await GET(mockReq('?days=0&limit=0'))
    expect((await res2.json()).data.days).toBe(7) // 0 is falsy → default, not clamped to 1
  })

  it('counts every message in the window, not just the returned page', async () => {
    // The page is capped at one row; the counts must still see all three.
    const res = await GET(mockReq())
    const json = await res.json()

    expect(json.data.notifications).toHaveLength(1)
    expect(json.data.total).toBe(3)
    expect(json.data.counts).toEqual({ 'booking.created': 2, 'cron.failed': 1 })
    expect(json.data.failed).toBe(1)
  })

  it('filters by kind when asked, and leaves the query unfiltered otherwise', async () => {
    await GET(mockReq('?kind=payment.chargeback'))
    expect(h.eqSpy).toHaveBeenCalledWith('payment.chargeback')

    vi.clearAllMocks()
    await GET(mockReq())
    expect(h.eqSpy).not.toHaveBeenCalled()
  })

  it('flags a truncated page so the UI does not imply it showed everything', async () => {
    h.feedRows = Array.from({ length: 5 }, (_, i) => row(`kind.n${i}`))

    const res = await GET(mockReq('?limit=5'))
    expect((await res.json()).data.truncated).toBe(true)

    const res2 = await GET(mockReq('?limit=50'))
    expect((await res2.json()).data.truncated).toBe(false)
  })
})
