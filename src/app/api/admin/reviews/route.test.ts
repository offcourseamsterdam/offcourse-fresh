import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

const state = vi.hoisted(() => ({
  reviews: [] as Record<string, unknown>[],
  config: null as Record<string, unknown> | null,
  bookingsCount: 0,
  bonuses: [] as { review_id: string; staff_id: string; amount_cents: number; awarded_at: string; staff: { name: string } | null }[],
  conflicts: [] as { review_id: string; matched_name: string; candidate_staff_ids: string[] }[],
  staff: [] as { id: string; name: string }[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'social_proof_reviews') {
        return { select: () => ({ order: async () => ({ data: state.reviews, error: null }) }) }
      }
      if (table === 'google_reviews_config') {
        return { select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: state.config, error: null }) }) }) }
      }
      if (table === 'bookings') {
        return { select: () => ({ in: async () => ({ count: state.bookingsCount, error: null }) }) }
      }
      if (table === 'review_bonuses') {
        return { select: async () => ({ data: state.bonuses, error: null }) }
      }
      if (table === 'review_bonus_conflicts') {
        return { select: () => ({ is: async () => ({ data: state.conflicts, error: null }) }) }
      }
      if (table === 'staff') {
        return { select: () => ({ in: async (_col: string, ids: string[]) => ({ data: state.staff.filter(s => ids.includes(s.id)), error: null }) }) }
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }),
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAdmin.mockResolvedValue(null)
  state.reviews = [{ id: 'r1', reviewer_name: 'Jane', rating: 5 }, { id: 'r2', reviewer_name: 'Joe', rating: 4 }, { id: 'r3', reviewer_name: 'Ann', rating: 5 }]
  state.config = null
  state.bookingsCount = 0
  state.bonuses = []
  state.conflicts = []
  state.staff = []
})

async function getReviews() {
  const res = await GET()
  const json = await (res as unknown as Response).json()
  return json.data.reviews as { id: string; matchStatus: Record<string, unknown> }[]
}

describe('GET /api/admin/reviews — per-review matchStatus (plan §3.2)', () => {
  it('a review with no bonus and no conflict is "no_match"', async () => {
    const reviews = await getReviews()
    expect(reviews.find(r => r.id === 'r1')!.matchStatus).toEqual({ status: 'no_match' })
  })

  it('a review with an awarded bonus is "assigned" with the staff name, amount, and award date', async () => {
    state.bonuses = [{ review_id: 'r1', staff_id: 's1', amount_cents: 500, awarded_at: '2026-08-15T00:00:00Z', staff: { name: 'Sophie de Vries' } }]

    const reviews = await getReviews()

    expect(reviews.find(r => r.id === 'r1')!.matchStatus).toEqual({
      status: 'assigned',
      assignees: [{ id: 's1', name: 'Sophie de Vries', amountCents: 500, awardedAt: '2026-08-15T00:00:00Z' }],
    })
  })

  it('a review with a pending conflict is "needs_confirmation" with named candidates', async () => {
    state.conflicts = [{ review_id: 'r2', matched_name: 'Will', candidate_staff_ids: ['s2', 's3'] }]
    state.staff = [{ id: 's2', name: 'Will Jansen' }, { id: 's3', name: 'William de Boer' }]

    const reviews = await getReviews()

    expect(reviews.find(r => r.id === 'r2')!.matchStatus).toEqual({
      status: 'needs_confirmation',
      matchedName: 'Will',
      candidates: [{ id: 's2', name: 'Will Jansen' }, { id: 's3', name: 'William de Boer' }],
    })
  })

  it('a pending conflict wins over a speculative near-miss award already sitting in review_bonuses', async () => {
    state.bonuses = [{ review_id: 'r3', staff_id: 's4', amount_cents: 500, awarded_at: '2026-08-15T00:00:00Z', staff: { name: 'Joshua' } }]
    state.conflicts = [{ review_id: 'r3', matched_name: 'Joshy', candidate_staff_ids: ['s4'] }]
    state.staff = [{ id: 's4', name: 'Joshua' }]

    const reviews = await getReviews()

    expect(reviews.find(r => r.id === 'r3')!.matchStatus.status).toBe('needs_confirmation')
  })

  it('falls back to "Unknown" for a candidate id no longer in the staff table', async () => {
    state.conflicts = [{ review_id: 'r2', matched_name: 'Will', candidate_staff_ids: ['gone'] }]
    state.staff = []

    const reviews = await getReviews()

    expect(reviews.find(r => r.id === 'r2')!.matchStatus).toEqual({
      status: 'needs_confirmation',
      matchedName: 'Will',
      candidates: [{ id: 'gone', name: 'Unknown' }],
    })
  })

  it('rejects a non-admin caller', async () => {
    h.requireAdmin.mockResolvedValue(new Response(null, { status: 403 }) as never)
    const res = await GET()
    expect((res as unknown as Response).status).toBe(403)
  })
})

describe('GET /api/admin/reviews — review-to-booking ratio denominator', () => {
  it('returns bookingsCount alongside reviews and config', async () => {
    state.bookingsCount = 456

    const res = await GET()
    const json = await (res as unknown as Response).json()

    expect(json.ok).toBe(true)
    expect(json.data.bookingsCount).toBe(456)
    expect(json.data.reviews).toHaveLength(3)
  })

  it('defaults bookingsCount to 0 when the count comes back null', async () => {
    const res = await GET()
    const json = await (res as unknown as Response).json()

    expect(json.data.bookingsCount).toBe(0)
  })
})
