import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  sendReviewBonusDm: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/scheduling/review-bonuses', () => ({ sendReviewBonusDm: h.sendReviewBonusDm }))

const state = vi.hoisted(() => ({
  review: null as Record<string, unknown> | null,
  bonus: null as { staff_id: string } | null,
  bonusUpserts: [] as Record<string, unknown>[],
  bonusDeletes: [] as { review_id: string; staff_id: string }[],
  conflictUpdates: [] as { review_id: string; patch: Record<string, unknown> }[],
  conversationUpdates: [] as { id: string; patch: Record<string, unknown> }[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'social_proof_reviews') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: state.review, error: state.review ? null : { message: 'not found' } }) }) }) }
      }
      if (table === 'review_bonuses') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.bonus }) }) }),
          upsert: (row: Record<string, unknown>) => {
            state.bonusUpserts.push(row)
            return Promise.resolve({ data: [row], error: null })
          },
          delete: () => ({
            eq: (_c1: string, reviewId: string) => ({
              eq: async (_c2: string, staffId: string) => {
                state.bonusDeletes.push({ review_id: reviewId, staff_id: staffId })
                return { error: null }
              },
            }),
          }),
        }
      }
      if (table === 'review_bonus_conflicts') {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: (_c: string, reviewId: string) => ({
              is: async () => {
                state.conflictUpdates.push({ review_id: reviewId, patch })
                return { error: null }
              },
            }),
          }),
        }
      }
      if (table === 'conversations') {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => {
              state.conversationUpdates.push({ id, patch })
              return { error: null }
            },
          }),
        }
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }),
}))

import { POST } from './route'

function makeReq(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAdmin.mockResolvedValue(null)
  state.review = { rating: 5, review_text: 'Sophie was amazing', conversation_id: null }
  state.bonus = null
  state.bonusUpserts = []
  state.bonusDeletes = []
  state.conflictUpdates = []
  state.conversationUpdates = []
})

describe('POST /api/admin/reviews/[id]/assign', () => {
  it('returns 404 when the review does not exist', async () => {
    state.review = null
    const res = await POST(makeReq({ staff_id: 's1' }), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(404)
  })

  it('first-time assignment on a "no match" review: inserts the bonus and DMs', async () => {
    const res = await POST(makeReq({ staff_id: 's1' }), { params: Promise.resolve({ id: 'r1' }) })

    expect(res.status).toBe(200)
    expect(state.bonusUpserts).toEqual([{ staff_id: 's1', review_id: 'r1', amount_cents: 500 }])
    expect(state.bonusDeletes).toHaveLength(0)
    expect(h.sendReviewBonusDm).toHaveBeenCalledWith(expect.anything(), 's1', 5, 'Sophie was amazing')
  })

  it('reassigns from one staff member to another: deletes the old bonus, inserts the new one, DMs only the new person', async () => {
    state.bonus = { staff_id: 's1' }
    const res = await POST(makeReq({ staff_id: 's2' }), { params: Promise.resolve({ id: 'r1' }) })

    expect(res.status).toBe(200)
    expect(state.bonusDeletes).toEqual([{ review_id: 'r1', staff_id: 's1' }])
    expect(state.bonusUpserts).toEqual([{ staff_id: 's2', review_id: 'r1', amount_cents: 500 }])
    expect(h.sendReviewBonusDm).toHaveBeenCalledWith(expect.anything(), 's2', 5, 'Sophie was amazing')
    expect(h.sendReviewBonusDm).toHaveBeenCalledTimes(1)
  })

  it('clearing an assignment (staff_id: null) deletes the bonus and sends no DM', async () => {
    state.bonus = { staff_id: 's1' }
    const res = await POST(makeReq({ staff_id: null }), { params: Promise.resolve({ id: 'r1' }) })

    expect(res.status).toBe(200)
    expect(state.bonusDeletes).toEqual([{ review_id: 'r1', staff_id: 's1' }])
    expect(state.bonusUpserts).toHaveLength(0)
    expect(h.sendReviewBonusDm).not.toHaveBeenCalled()
  })

  it('re-confirming the same staff member is a no-op on review_bonuses and sends no duplicate DM', async () => {
    state.bonus = { staff_id: 's1' }
    const res = await POST(makeReq({ staff_id: 's1' }), { params: Promise.resolve({ id: 'r1' }) })

    expect(res.status).toBe(200)
    expect(state.bonusDeletes).toHaveLength(0)
    expect(state.bonusUpserts).toHaveLength(0)
    expect(h.sendReviewBonusDm).not.toHaveBeenCalled()
  })

  it('resolves any pending review_bonus_conflicts row for this review with the chosen staff_id', async () => {
    await POST(makeReq({ staff_id: 's2' }), { params: Promise.resolve({ id: 'r1' }) })

    expect(state.conflictUpdates).toEqual([{ review_id: 'r1', patch: expect.objectContaining({ awarded_staff_id: 's2' }) }])
  })

  it('auto-resolves the source conversation when the review came from the GYG email path', async () => {
    state.review = { rating: 5, review_text: 'Sophie was amazing', conversation_id: 'conv-42' }
    await POST(makeReq({ staff_id: 's1' }), { params: Promise.resolve({ id: 'r1' }) })

    expect(state.conversationUpdates).toEqual([{ id: 'conv-42', patch: { status: 'resolved' } }])
  })

  it('does not touch any conversation when the review has no conversation_id (Outscraper/scraper path)', async () => {
    await POST(makeReq({ staff_id: 's1' }), { params: Promise.resolve({ id: 'r1' }) })
    expect(state.conversationUpdates).toHaveLength(0)
  })

  it('rejects a non-admin caller before touching any data', async () => {
    h.requireAdmin.mockResolvedValue(new Response(null, { status: 403 }) as never)
    const res = await POST(makeReq({ staff_id: 's1' }), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(403)
    expect(state.bonusUpserts).toHaveLength(0)
  })
})
