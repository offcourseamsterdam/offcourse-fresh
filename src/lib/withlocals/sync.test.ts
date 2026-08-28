import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  resolveExperienceUuid: vi.fn().mockResolvedValue('uuid-1'),
  fetchAllWithlocalsReviews: vi.fn().mockResolvedValue([]),
  scanReviewsForBonuses: vi.fn().mockResolvedValue([]),
}))
vi.mock('./client', () => ({ resolveExperienceUuid: h.resolveExperienceUuid, fetchAllWithlocalsReviews: h.fetchAllWithlocalsReviews }))
vi.mock('@/lib/scheduling/review-bonuses', () => ({ scanReviewsForBonuses: h.scanReviewsForBonuses }))

const state = vi.hoisted(() => ({
  existingCrossPlatform: [] as { id: string; review_text: string }[],
  existingWithlocals: [] as { id: string; external_review_id: string }[],
  insertedRows: [] as { id: string; review_text: string | null; rating: number }[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'social_proof_reviews') {
        return {
          select: (cols: string) => {
            if (cols.includes('external_review_id')) {
              return { eq: () => Promise.resolve({ data: state.existingWithlocals, error: null }) }
            }
            return {
              neq: () => ({ not: () => Promise.resolve({ data: state.existingCrossPlatform, error: null }) }),
            }
          },
          insert: (rows: { review_text: string | null; rating: number }[]) => ({
            select: async () => {
              const inserted = rows.map((r, i) => ({ id: `new-${i}`, review_text: r.review_text, rating: r.rating }))
              state.insertedRows = inserted
              return { data: inserted, error: null }
            },
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'google_reviews_config') {
        return { update: () => ({ not: async () => ({ error: null }) }) }
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }),
}))

import { syncWithlocalsReviews } from './sync'
import type { WithlocalsReview } from './client'

function makeRawReview(overrides: Partial<WithlocalsReview> = {}): WithlocalsReview {
  return {
    id: 'wl-1',
    experience_id: 'exp-1',
    title: null,
    comment: 'Sophie was amazing, best trip ever',
    guest_name: 'Ann',
    guest_picture: null,
    guest_country_iso: null,
    guest_country_name: null,
    rating: 10,
    scale: 10,
    detected_language: 'en',
    created: '2026-08-01T00:00:00',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveExperienceUuid.mockResolvedValue('uuid-1')
  h.fetchAllWithlocalsReviews.mockResolvedValue([])
  h.scanReviewsForBonuses.mockResolvedValue([])
  state.existingCrossPlatform = []
  state.existingWithlocals = []
  state.insertedRows = []
})

describe('syncWithlocalsReviews — auto-scans new reviews (Beer, 2026-08-23: "how will we do so for each platform?")', () => {
  it('runs scanReviewsForBonuses on every freshly-inserted review', async () => {
    h.fetchAllWithlocalsReviews.mockResolvedValue([makeRawReview({ id: 'wl-1', rating: 10, scale: 10 })])

    await syncWithlocalsReviews('shortid')

    expect(h.scanReviewsForBonuses).toHaveBeenCalledTimes(1)
    expect(h.scanReviewsForBonuses).toHaveBeenCalledWith([
      { id: 'new-0', reviewText: expect.stringContaining('Sophie was amazing'), rating: 5 },
    ])
  })

  it('does not scan anything when there are no new reviews', async () => {
    h.fetchAllWithlocalsReviews.mockResolvedValue([])

    await syncWithlocalsReviews('shortid')

    expect(h.scanReviewsForBonuses).not.toHaveBeenCalled()
  })

  it('does not scan a review that already exists (not newly inserted)', async () => {
    state.existingWithlocals = [{ id: 'existing-1', external_review_id: 'wl-1' }]
    h.fetchAllWithlocalsReviews.mockResolvedValue([makeRawReview({ id: 'wl-1' })])

    await syncWithlocalsReviews('shortid')

    expect(h.scanReviewsForBonuses).not.toHaveBeenCalled()
  })
})
