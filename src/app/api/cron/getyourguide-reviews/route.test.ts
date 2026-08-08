import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Covers the 2026-08-08 change: this cron now loops over every product in
 * GYG_PRODUCT_URLS instead of checking a single hardcoded page — Off Course
 * has multiple GetYourGuide listings (confirmed via real "new review" emails
 * naming different products), and checking only one here would silently
 * never pick up reviews for the others.
 */

const h = vi.hoisted(() => ({
  requireCronSecret: vi.fn().mockReturnValue(null),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
  syncGYGReviews: vi.fn(),
}))

vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))
vi.mock('@/lib/getyourguide/sync', () => ({
  syncGYGReviews: h.syncGYGReviews,
  GYG_PRODUCT_URLS: {
    'Product A': 'https://gyg.example/a',
    'Product B': 'https://gyg.example/b',
  },
}))

import { GET } from './route'

const req = {} as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  h.requireCronSecret.mockReturnValue(null)
  h.alertCronFailure.mockResolvedValue(undefined)
})

describe('GET /api/cron/getyourguide-reviews', () => {
  it('syncs every configured product and sums imported/skipped across all of them', async () => {
    h.syncGYGReviews.mockImplementation(async (url: string) =>
      url === 'https://gyg.example/a'
        ? { imported: 2, skipped: 1, blocked: false }
        : { imported: 3, skipped: 0, blocked: false },
    )

    const res = await GET(req)
    const json = await res.json()

    expect(h.syncGYGReviews).toHaveBeenCalledTimes(2)
    expect(h.syncGYGReviews).toHaveBeenCalledWith('https://gyg.example/a')
    expect(h.syncGYGReviews).toHaveBeenCalledWith('https://gyg.example/b')
    expect(json).toEqual({ ok: true, imported: 5, skipped: 1, blockedProducts: [] })
  })

  it('one product being blocked does not stop the others from syncing', async () => {
    h.syncGYGReviews.mockImplementation(async (url: string) =>
      url === 'https://gyg.example/a'
        ? { imported: 0, skipped: 0, blocked: true }
        : { imported: 4, skipped: 0, blocked: false },
    )

    const res = await GET(req)
    const json = await res.json()

    expect(json).toEqual({ ok: true, imported: 4, skipped: 0, blockedProducts: ['Product A'] })
  })

  it('rejects when the cron secret is missing', async () => {
    const denied = new Response('denied', { status: 401 })
    h.requireCronSecret.mockReturnValue(denied)

    const res = await GET(req)

    expect(res).toBe(denied)
    expect(h.syncGYGReviews).not.toHaveBeenCalled()
  })

  it('alerts and returns 500 if a product sync throws', async () => {
    h.syncGYGReviews.mockRejectedValue(new Error('network blew up'))

    const res = await GET(req)

    expect(res.status).toBe(500)
    expect(h.alertCronFailure).toHaveBeenCalledWith('getyourguide-reviews', expect.any(Error))
  })
})
