import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Covers the 2026-07 fix: this route used to do its own slug→id lookup (via
 * the cookie-aware client) before calling getFilteredAvailability(id, ...) —
 * a redundant round-trip, since that function immediately re-queried
 * cruise_listings by id anyway. Now uses getFilteredAvailabilityBySlug, which
 * does both the is_published check and the filter-config fetch in one query.
 * This test guards the behavior that changed as a result: a missing/
 * unpublished listing must still 404, not silently return empty slots.
 */

const h = vi.hoisted(() => ({
  getFilteredAvailabilityBySlug: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: () => null }))
vi.mock('@/lib/fareharbor/availability', () => ({
  getFilteredAvailabilityBySlug: h.getFilteredAvailabilityBySlug,
}))

import { GET } from './route'

function mockReq(params: Record<string, string>): NextRequest {
  const url = new URL('https://example.com/api/search/slots')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return { nextUrl: url } as unknown as NextRequest
}

describe('GET /api/search/slots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when slug or date is missing', async () => {
    const res = await GET(mockReq({ date: '2026-08-01' }))
    expect(res.status).toBe(400)
    expect(h.getFilteredAvailabilityBySlug).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed date', async () => {
    const res = await GET(mockReq({ slug: 'canal-cruise', date: '08/01/2026' }))
    expect(res.status).toBe(400)
  })

  it('SECURITY/REGRESSION: 404s when the listing does not exist or is unpublished (LISTING_NOT_FOUND)', async () => {
    h.getFilteredAvailabilityBySlug.mockResolvedValue({ slots: [], reasonCode: 'LISTING_NOT_FOUND' })

    const res = await GET(mockReq({ slug: 'nope', date: '2026-08-01' }))

    expect(res.status).toBe(404)
  })

  it('returns 200 with empty slots (not 404) when the listing exists but has no availability that date', async () => {
    h.getFilteredAvailabilityBySlug.mockResolvedValue({ slots: [], reasonCode: 'NO_AVAILABILITIES' })

    const res = await GET(mockReq({ slug: 'canal-cruise', date: '2026-08-01' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.slots).toEqual([])
    expect(json.data.reasonCode).toBe('NO_AVAILABILITIES')
  })

  it('returns 200 with the real slots on the happy path, looked up in one call by slug', async () => {
    h.getFilteredAvailabilityBySlug.mockResolvedValue({
      slots: [{ startAt: '2026-08-01T15:00:00Z' }],
      reasonCode: null,
    })

    const res = await GET(mockReq({ slug: 'canal-cruise', date: '2026-08-01', guests: '3' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.slots).toHaveLength(1)
    expect(h.getFilteredAvailabilityBySlug).toHaveBeenCalledWith('canal-cruise', '2026-08-01', 3)
    expect(h.getFilteredAvailabilityBySlug).toHaveBeenCalledTimes(1)
  })
})
