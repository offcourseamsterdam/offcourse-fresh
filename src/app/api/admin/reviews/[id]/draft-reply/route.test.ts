import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  draftReviewReply: vi.fn().mockResolvedValue('Ann! Glad you had a good time.'),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/reviews/draft-reply', () => ({ draftReviewReply: h.draftReviewReply }))

const state = vi.hoisted(() => ({
  review: null as Record<string, unknown> | null,
  recentDrafts: [] as { ai_draft_reply: string | null }[],
  saved: [] as { id: string; patch: Record<string, unknown> }[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'social_proof_reviews') throw new Error(`unexpected table "${table}"`)
      return {
        select: () => ({
          // review-by-id query chain: .eq().single()
          eq: (_c: string, id: string) => ({
            single: async () => ({ data: state.review, error: state.review ? null : { message: 'not found' } }),
          }),
          // recent-drafts query chain: .not().neq().order().limit()
          not: () => ({
            neq: () => ({
              order: () => ({
                limit: async () => ({ data: state.recentDrafts, error: null }),
              }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_c: string, id: string) => {
            state.saved.push({ id, patch })
            return { error: null }
          },
        }),
      }
    },
  }),
}))

import { POST } from './route'

function makeReq(): NextRequest {
  return {} as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAdmin.mockResolvedValue(null)
  h.draftReviewReply.mockResolvedValue('Ann! Glad you had a good time.')
  state.review = { reviewer_name: 'Ann', review_text: 'Great trip!', rating: 5, source: 'google' }
  state.recentDrafts = []
  state.saved = []
})

describe('POST /api/admin/reviews/[id]/draft-reply', () => {
  it('returns 404 when the review does not exist', async () => {
    state.review = null
    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(404)
  })

  it('returns 400 when the review has no text to reply to', async () => {
    state.review = { reviewer_name: 'Ann', review_text: null, rating: 5, source: 'google' }
    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(400)
  })

  it('returns 400 for a Withlocals review — no reply mechanism exists to draft for, enforced server-side too', async () => {
    state.review = { reviewer_name: 'Ann', review_text: 'Great trip!', rating: 5, source: 'withlocals' }
    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(400)
    expect(h.draftReviewReply).not.toHaveBeenCalled()
  })

  it('drafts a reply, saves it, and returns it', async () => {
    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'r1' }) })
    const json = await (res as unknown as Response).json()

    expect(res.status).toBe(200)
    expect(json.data.draft).toBe('Ann! Glad you had a good time.')
    expect(state.saved).toEqual([{ id: 'r1', patch: { ai_draft_reply: 'Ann! Glad you had a good time.' } }])
  })

  it('passes the review fields and recent drafts through to draftReviewReply', async () => {
    state.recentDrafts = [{ ai_draft_reply: 'Joe, that sunset though.' }, { ai_draft_reply: null }]

    await POST(makeReq(), { params: Promise.resolve({ id: 'r1' }) })

    expect(h.draftReviewReply).toHaveBeenCalledWith({
      platform: 'google',
      reviewerName: 'Ann',
      reviewText: 'Great trip!',
      rating: 5,
      recentReplies: ['Joe, that sunset though.'],
    })
  })

  it('returns a 502 when Claude fails, without saving anything', async () => {
    h.draftReviewReply.mockRejectedValue(new Error('anthropic down'))

    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'r1' }) })

    expect(res.status).toBe(502)
    expect(state.saved).toHaveLength(0)
  })

  it('rejects a non-admin caller before touching any data', async () => {
    h.requireAdmin.mockResolvedValue(new Response(null, { status: 403 }) as never)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(403)
    expect(h.draftReviewReply).not.toHaveBeenCalled()
  })
})
