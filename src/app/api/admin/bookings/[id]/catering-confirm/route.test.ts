import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  single: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  emitOpsEvent: vi.fn(),
}))

vi.mock('@/lib/auth/require-admin', () => ({
  requireAdmin: h.requireAdmin,
}))

vi.mock('@/lib/ops/events', () => ({
  emitOpsEvent: h.emitOpsEvent,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'bookings') {
        return {
          select: () => ({
            eq: () => ({
              single: h.single,
            }),
          }),
          update: (patch: any) => ({
            eq: () => {
              h.update(patch)
              return { error: null }
            },
          }),
        }
      }
      return {}
    },
  }),
}))

describe('POST /api/admin/bookings/[id]/catering-confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('rejects unauthenticated requests', async () => {
    h.requireAdmin.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const req = new NextRequest('http://localhost/api/admin/bookings/b1/catering-confirm', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'b1' }) })
    expect(res.status).toBe(401)
  })

  it('marks the booking as confirmed and emits ops event', async () => {
    h.single.mockResolvedValue({
      data: {
        id: 'b1',
        customer_name: 'Jessica Brennan',
        booking_date: '2026-09-08',
        catering_confirmed_at: null,
      },
      error: null,
    })

    const req = new NextRequest('http://localhost/api/admin/bookings/b1/catering-confirm', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'b1' }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.data.ok).toBe(true)
    expect(json.data.confirmed_at).toBeDefined()

    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ catering_confirmed_at: expect.any(String) }),
    )
    expect(h.emitOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'catering_confirmed',
        actorType: 'human',
        bookingId: 'b1',
        payload: expect.objectContaining({ manual: true, bookingDate: '2026-09-08' }),
      }),
    )
  })
})
