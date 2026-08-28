import { describe, it, expect } from 'vitest'
import { computeReviewsOverview } from './overview'
import type { Review } from './types'

const NOW = new Date('2026-08-22T12:00:00Z')

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'r1',
    reviewer_name: 'Ann',
    review_text: 'Great trip!',
    rating: 5,
    source: 'google',
    is_active: true,
    sort_order: 0,
    author_photo_url: null,
    google_profile_url: null,
    external_review_id: null,
    review_image_url: null,
    publish_time: '2026-08-10T00:00:00Z',
    original_text: null,
    language: null,
    created_at: '2026-08-10T00:00:00Z',
    matchStatus: { status: 'no_match' },
    ai_draft_reply: null,
    replied_at: null,
    bonus_checked_at: '2026-08-10T00:00:00Z',
    ...overrides,
  }
}

describe('computeReviewsOverview', () => {
  it('counts a review published this month as newThisMonth', () => {
    const reviews = [makeReview({ publish_time: '2026-08-05T00:00:00Z' })]
    expect(computeReviewsOverview(reviews, NOW).newThisMonth).toHaveLength(1)
  })

  it('excludes a review published last month', () => {
    const reviews = [makeReview({ publish_time: '2026-07-31T23:59:59Z' })]
    expect(computeReviewsOverview(reviews, NOW).newThisMonth).toHaveLength(0)
  })

  it('falls back to created_at when publish_time is null', () => {
    const reviews = [makeReview({ publish_time: null, created_at: '2026-08-03T00:00:00Z' })]
    expect(computeReviewsOverview(reviews, NOW).newThisMonth).toHaveLength(1)
  })

  it('counts needs_confirmation reviews as unassigned, regardless of month', () => {
    const reviews = [
      makeReview({ id: 'r1', publish_time: '2026-07-01T00:00:00Z', matchStatus: { status: 'needs_confirmation', matchedName: 'Will', candidates: [] } }),
      makeReview({ id: 'r2', matchStatus: { status: 'no_match' } }),
      makeReview({ id: 'r3', matchStatus: { status: 'assigned', assignees: [{ id: 's1', name: 'Sophie', amountCents: 500, awardedAt: '2026-08-10T00:00:00Z' }] } }),
    ]
    expect(computeReviewsOverview(reviews, NOW).unassignedCount).toBe(1)
  })

  it('counts a 5-star review with no bonus_checked_at as unscanned', () => {
    const reviews = [makeReview({ rating: 5, bonus_checked_at: null })]
    expect(computeReviewsOverview(reviews, NOW).unscannedCount).toBe(1)
  })

  it('does not count a sub-5-star review as unscanned even without bonus_checked_at — it was never eligible for scanning', () => {
    const reviews = [makeReview({ rating: 4, bonus_checked_at: null })]
    expect(computeReviewsOverview(reviews, NOW).unscannedCount).toBe(0)
  })

  it('sums bonus amounts awarded this month, across all reviews, regardless of the review\'s own month', () => {
    const reviews = [
      makeReview({ id: 'r1', publish_time: '2026-06-01T00:00:00Z', matchStatus: { status: 'assigned', assignees: [{ id: 's1', name: 'Sophie', amountCents: 500, awardedAt: '2026-08-15T00:00:00Z' }] } }),
      makeReview({ id: 'r2', matchStatus: { status: 'assigned', assignees: [{ id: 's2', name: 'Tariq', amountCents: 500, awardedAt: '2026-07-01T00:00:00Z' }] } }),
    ]
    expect(computeReviewsOverview(reviews, NOW).bonusCentsThisMonth).toBe(500)
  })

  it('sums multiple assignees on the same review awarded this month', () => {
    const reviews = [
      makeReview({
        matchStatus: {
          status: 'assigned',
          assignees: [
            { id: 's1', name: 'Sophie', amountCents: 500, awardedAt: '2026-08-01T00:00:00Z' },
            { id: 's2', name: 'Tariq', amountCents: 500, awardedAt: '2026-08-02T00:00:00Z' },
          ],
        },
      }),
    ]
    expect(computeReviewsOverview(reviews, NOW).bonusCentsThisMonth).toBe(1000)
  })

  it('is all zero/empty for an empty review list', () => {
    expect(computeReviewsOverview([], NOW)).toEqual({
      newThisMonth: [],
      unassignedCount: 0,
      unscannedCount: 0,
      bonusCentsThisMonth: 0,
    })
  })
})
