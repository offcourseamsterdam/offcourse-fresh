import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Covers the DELETE safety check (2026-07 fix): it previously filtered on
 * 'pending' — a value nothing ever writes to bookings.status (the real value is
 * 'pending_payment') — and omitted paid_pending_fh/fh_in_progress entirely,
 * silently allowing deletion of a listing with money already in flight.
 */

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  count: vi.fn(),
  inSpy: vi.fn(),
  deleteEq: vi.fn().mockResolvedValue({ error: null }),
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'bookings') {
        return {
          select: () => ({
            eq: () => ({
              in: (col: string, values: string[]) => { h.inSpy(col, values); return h.count() },
            }),
          }),
        }
      }
      // 'cruise_listings' delete
      return { delete: () => ({ eq: h.deleteEq }) }
    },
  }),
}))

import { DELETE } from './route'

function mockReq(): NextRequest {
  return {} as unknown as NextRequest
}

function params(id = 'listing-1') {
  return { params: Promise.resolve({ id }) }
}

describe('DELETE /api/admin/cruise-listings/[id] — active-booking safety check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.deleteEq.mockResolvedValue({ error: null })
  })

  it('allows deletion when there are no active bookings', async () => {
    h.count.mockResolvedValue({ count: 0 })

    const res = await DELETE(mockReq(), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.deleted).toBe(true)
  })

  it('SECURITY: the status filter includes pending_payment, paid_pending_fh, and fh_in_progress (the exact bug fixed)', async () => {
    h.count.mockResolvedValue({ count: 0 })

    await DELETE(mockReq(), params())

    expect(h.inSpy).toHaveBeenCalledTimes(1)
    const [col, values] = h.inSpy.mock.calls[0]
    expect(col).toBe('status')
    expect(values).toEqual(expect.arrayContaining(['pending_payment', 'paid_pending_fh', 'fh_in_progress', 'confirmed', 'booked']))
    // The old, dead 'pending' value must NOT reappear — that was the actual bug.
    expect(values).not.toContain('pending')
  })

  it('blocks deletion (409) when the count of matching bookings is non-zero, and never deletes the listing', async () => {
    h.count.mockResolvedValue({ count: 2 })

    const res = await DELETE(mockReq(), params())
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toContain('2 active bookings')
    expect(h.deleteEq).not.toHaveBeenCalled()
  })
})
