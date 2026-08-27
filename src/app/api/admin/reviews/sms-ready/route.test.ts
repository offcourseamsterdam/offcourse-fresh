import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  bookings: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
}))

vi.mock('@/lib/auth/require-admin', () => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'bookings') throw new Error(`unexpected table "${table}"`)
      return {
        select: () => ({
          in: () => ({
            is: () => ({
              not: () => ({
                lte: () => ({
                  gte: () => ({
                    order: () => ({
                      limit: () => Promise.resolve({ data: state.bookings, error: state.error }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }
    },
  }),
}))

describe('GET /api/admin/reviews/sms-ready', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.bookings = []
    state.error = null
  })

  it('returns the eligible bookings list', async () => {
    state.bookings = [
      { id: 'b1', customer_name: 'Anna Smith', customer_phone: '0612345678', listing_title: 'Sunset Cruise', end_time: '2026-08-26T18:30:00Z', booking_date: '2026-08-26' },
    ]
    const { GET } = await import('./route')
    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.data.bookings).toHaveLength(1)
    expect(json.data.bookings[0].customer_name).toBe('Anna Smith')
  })

  it('returns an empty list when nothing is eligible', async () => {
    const { GET } = await import('./route')
    const res = await GET()
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.data.bookings).toEqual([])
  })

  it('returns a 500 with a safe message on a query error', async () => {
    state.error = { message: 'column "review_sms_sent_at" does not exist' }
    const { GET } = await import('./route')
    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.ok).toBe(false)
    expect(json.error).toBe('Failed to load ready-to-send bookings')
  })
})
