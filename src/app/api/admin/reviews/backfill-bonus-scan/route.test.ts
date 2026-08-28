import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => unknown) => cb() }
})

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  scanReviewsForBonuses: vi.fn().mockResolvedValue([]),
  postSlackDM: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/scheduling/review-bonuses', () => ({ scanReviewsForBonuses: h.scanReviewsForBonuses }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackDM: h.postSlackDM }))

const state = vi.hoisted(() => ({
  unscanned: [] as { id: string; reviewer_name: string; review_text: string | null; original_text: string | null; rating: number }[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'social_proof_reviews') throw new Error(`unexpected table "${table}"`)
      return {
        select: () => ({
          eq: () => ({
            is: async () => ({ data: state.unscanned, error: null }),
          }),
        }),
      }
    },
  }),
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAdmin.mockResolvedValue(null)
  h.scanReviewsForBonuses.mockResolvedValue([])
  state.unscanned = []
})

describe('POST /api/admin/reviews/backfill-bonus-scan', () => {
  it('returns started:false when there is nothing unscanned', async () => {
    const res = await POST()
    const json = await (res as unknown as Response).json()

    expect(json.data).toEqual({ started: false, count: 0 })
    expect(h.scanReviewsForBonuses).not.toHaveBeenCalled()
  })

  it('scans every unscanned 5-star review and reports a clean summary via Slack', async () => {
    state.unscanned = [
      { id: 'r1', reviewer_name: 'Ann', review_text: 'Sophie was great', original_text: null, rating: 5 },
      { id: 'r2', reviewer_name: 'Joe', review_text: 'Lovely trip', original_text: null, rating: 5 },
    ]
    h.scanReviewsForBonuses.mockResolvedValue([{ id: 'r1', unmatchedNames: [] }, { id: 'r2', unmatchedNames: [] }])

    const res = await POST()
    const json = await (res as unknown as Response).json()

    expect(json.data).toEqual({ started: true, count: 2 })
    expect(h.scanReviewsForBonuses).toHaveBeenCalledWith([
      { id: 'r1', reviewText: 'Sophie was great', originalText: null, rating: 5 },
      { id: 'r2', reviewText: 'Lovely trip', originalText: null, rating: 5 },
    ])
    expect(h.postSlackDM).toHaveBeenCalledWith(expect.stringContaining('2 reviews checked, no unrecognized names'))
  })

  it('reports unmatched names (candidate captains) via Slack, with which review they came from', async () => {
    state.unscanned = [{ id: 'r1', reviewer_name: 'Ann', review_text: 'Marco was our guide', original_text: null, rating: 5 }]
    h.scanReviewsForBonuses.mockResolvedValue([{ id: 'r1', unmatchedNames: ['Marco'] }])

    await POST()

    const message = h.postSlackDM.mock.calls[0][0] as string
    expect(message).toContain('Marco')
    expect(message).toContain("Ann's review")
  })

  it('rejects a non-admin caller before querying anything', async () => {
    h.requireAdmin.mockResolvedValue(new Response(null, { status: 403 }) as never)
    const res = await POST()
    expect((res as unknown as Response).status).toBe(403)
    expect(h.scanReviewsForBonuses).not.toHaveBeenCalled()
  })
})
