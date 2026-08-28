import { describe, it, expect } from 'vitest'
import { computeMonthlyStats, computeMonthlyGrowth } from './monthly-stats'
import type { Review } from './types'

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

describe('computeMonthlyStats', () => {
  it('counts a captain\'s bonus in the month it was awarded, not the month the review is from', () => {
    const reviews = [
      makeReview({
        publish_time: '2026-03-01T00:00:00Z',
        matchStatus: { status: 'assigned', assignees: [{ id: 's1', name: 'Sophie', amountCents: 500, awardedAt: '2026-08-15T00:00:00Z' }] },
      }),
    ]
    // August 2026 = year 2026, month 7 (0-indexed)
    expect(computeMonthlyStats(reviews, 2026, 7).perCaptain).toEqual([{ id: 's1', name: 'Sophie', bonusCount: 1, amountCents: 500 }])
    expect(computeMonthlyStats(reviews, 2026, 2).perCaptain).toEqual([]) // March — the review's own month
  })

  it('sums multiple bonuses for the same captain in the same month', () => {
    const reviews = [
      makeReview({ id: 'r1', matchStatus: { status: 'assigned', assignees: [{ id: 's1', name: 'Sophie', amountCents: 500, awardedAt: '2026-08-01T00:00:00Z' }] } }),
      makeReview({ id: 'r2', matchStatus: { status: 'assigned', assignees: [{ id: 's1', name: 'Sophie', amountCents: 500, awardedAt: '2026-08-20T00:00:00Z' }] } }),
    ]
    expect(computeMonthlyStats(reviews, 2026, 7).perCaptain).toEqual([{ id: 's1', name: 'Sophie', bonusCount: 2, amountCents: 1000 }])
  })

  it('sorts captains by amount descending', () => {
    const reviews = [
      makeReview({ id: 'r1', matchStatus: { status: 'assigned', assignees: [{ id: 's1', name: 'Sophie', amountCents: 500, awardedAt: '2026-08-01T00:00:00Z' }] } }),
      makeReview({ id: 'r2', matchStatus: { status: 'assigned', assignees: [{ id: 's2', name: 'Tariq', amountCents: 500, awardedAt: '2026-08-02T00:00:00Z' }] } }),
      makeReview({ id: 'r3', matchStatus: { status: 'assigned', assignees: [{ id: 's2', name: 'Tariq', amountCents: 500, awardedAt: '2026-08-03T00:00:00Z' }] } }),
    ]
    expect(computeMonthlyStats(reviews, 2026, 7).perCaptain.map(c => c.name)).toEqual(['Tariq', 'Sophie'])
  })

  it('counts reviews per platform for the selected month, by publish date', () => {
    const reviews = [
      makeReview({ id: 'r1', source: 'google', publish_time: '2026-08-05T00:00:00Z' }),
      makeReview({ id: 'r2', source: 'google', publish_time: '2026-08-06T00:00:00Z' }),
      makeReview({ id: 'r3', source: 'withlocals', publish_time: '2026-08-07T00:00:00Z' }),
      makeReview({ id: 'r4', source: 'google', publish_time: '2026-07-01T00:00:00Z' }),
    ]
    const stats = computeMonthlyStats(reviews, 2026, 7)
    expect(stats.perPlatform).toEqual([{ source: 'google', count: 2 }, { source: 'withlocals', count: 1 }])
    expect(stats.totalReviews).toBe(3)
  })

  it('falls back to created_at when publish_time is null for platform counting', () => {
    const reviews = [makeReview({ publish_time: null, created_at: '2026-08-01T00:00:00Z' })]
    expect(computeMonthlyStats(reviews, 2026, 7).totalReviews).toBe(1)
  })

  it('is empty for a month with no activity', () => {
    expect(computeMonthlyStats([], 2026, 7)).toEqual({ perCaptain: [], perPlatform: [], totalReviews: 0 })
  })
})

describe('computeMonthlyGrowth', () => {
  const NOW = new Date('2026-08-23T12:00:00Z')

  it('returns monthsBack entries, oldest first, ending with the current month', () => {
    const months = computeMonthlyGrowth([], 3, NOW)
    expect(months.map(m => `${m.year}-${m.month}`)).toEqual(['2026-5', '2026-6', '2026-7'])
  })

  it('buckets review counts per source into the correct month', () => {
    const reviews = [
      makeReview({ id: 'r1', source: 'google', publish_time: '2026-06-15T00:00:00Z' }),
      makeReview({ id: 'r2', source: 'google', publish_time: '2026-06-20T00:00:00Z' }),
      makeReview({ id: 'r3', source: 'withlocals', publish_time: '2026-08-01T00:00:00Z' }),
    ]
    const months = computeMonthlyGrowth(reviews, 3, NOW)
    const june = months.find(m => m.month === 5)!
    const august = months.find(m => m.month === 7)!
    expect(june.bySource).toEqual({ google: 2 })
    expect(june.total).toBe(2)
    expect(august.bySource).toEqual({ withlocals: 1 })
    expect(august.total).toBe(1)
  })

  it('handles a December-to-January year rollover correctly', () => {
    const now = new Date('2026-01-15T00:00:00Z')
    const months = computeMonthlyGrowth([], 2, now)
    expect(months).toEqual([
      expect.objectContaining({ year: 2025, month: 11 }),
      expect.objectContaining({ year: 2026, month: 0 }),
    ])
  })

  it('produces a zero-total month when nothing was published then', () => {
    const months = computeMonthlyGrowth([], 1, NOW)
    expect(months[0]!.total).toBe(0)
    expect(months[0]!.bySource).toEqual({})
  })
})
