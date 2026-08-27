import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  reviews: [] as Record<string, unknown>[],
  config: null as Record<string, unknown> | null,
  bookingsCount: 0,
}))

vi.mock('@/lib/auth/require-admin', () => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'social_proof_reviews') {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: state.reviews, error: null }),
          }),
        }
      }
      if (table === 'google_reviews_config') {
        return {
          select: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: state.config, error: null }),
            }),
          }),
        }
      }
      if (table === 'bookings') {
        return {
          select: () => ({
            in: () => Promise.resolve({ count: state.bookingsCount, error: null }),
          }),
        }
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }),
}))

describe('GET /api/admin/reviews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.reviews = []
    state.config = null
    state.bookingsCount = 0
  })

  it('returns reviews, config, and the review-to-booking ratio denominator', async () => {
    state.reviews = [
      { id: 'r1', rating: 5, reviewer_name: 'Anna' },
      { id: 'r2', rating: 4, reviewer_name: 'Jon' },
    ]
    state.bookingsCount = 456

    const { GET } = await import('./route')
    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.data.reviews).toHaveLength(2)
    expect(json.data.bookingsCount).toBe(456)
  })

  it('defaults bookingsCount to 0 when the count comes back null', async () => {
    const { GET } = await import('./route')
    const res = await GET()
    const json = await res.json()

    expect(json.data.bookingsCount).toBe(0)
  })
})
