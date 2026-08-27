import { describe, it, expect } from 'vitest'
import { computeReviewToBookingRatio } from './ratio'

describe('computeReviewToBookingRatio', () => {
  it('buckets reviews by star rating and divides by bookings count', () => {
    const reviews = [
      { rating: 5 }, { rating: 5 }, { rating: 5 },
      { rating: 4 },
      { rating: 1 },
    ]
    const result = computeReviewToBookingRatio(reviews, 100)

    expect(result.totalReviews).toBe(5)
    expect(result.bookingsCount).toBe(100)
    expect(result.overallRatio).toBeCloseTo(0.05)

    const fiveStar = result.byStars.find(b => b.stars === 5)!
    expect(fiveStar.count).toBe(3)
    expect(fiveStar.ratio).toBeCloseTo(0.03)

    const fourStar = result.byStars.find(b => b.stars === 4)!
    expect(fourStar.count).toBe(1)
    expect(fourStar.ratio).toBeCloseTo(0.01)

    const oneStar = result.byStars.find(b => b.stars === 1)!
    expect(oneStar.count).toBe(1)

    for (const stars of [3, 2]) {
      expect(result.byStars.find(b => b.stars === stars)!.count).toBe(0)
    }
  })

  it('orders buckets 5 down to 1 star', () => {
    const result = computeReviewToBookingRatio([], 10)
    expect(result.byStars.map(b => b.stars)).toEqual([5, 4, 3, 2, 1])
  })

  it('returns 0 ratios (not division by zero / NaN) when there are no bookings', () => {
    const result = computeReviewToBookingRatio([{ rating: 5 }], 0)
    expect(result.overallRatio).toBe(0)
    expect(result.byStars.find(b => b.stars === 5)!.ratio).toBe(0)
    expect(Number.isNaN(result.overallRatio)).toBe(false)
  })

  it('rounds fractional ratings to the nearest star', () => {
    const result = computeReviewToBookingRatio([{ rating: 4.6 }, { rating: 4.4 }], 10)
    expect(result.byStars.find(b => b.stars === 5)!.count).toBe(1)
    expect(result.byStars.find(b => b.stars === 4)!.count).toBe(1)
  })

  it('ignores out-of-range ratings rather than throwing', () => {
    const result = computeReviewToBookingRatio([{ rating: 0 }, { rating: 6 }, { rating: 5 }], 10)
    expect(result.totalReviews).toBe(3)
    expect(result.byStars.find(b => b.stars === 5)!.count).toBe(1)
    const sumBucketed = result.byStars.reduce((sum, b) => sum + b.count, 0)
    expect(sumBucketed).toBe(1)
  })

  it('handles an empty reviews list', () => {
    const result = computeReviewToBookingRatio([], 50)
    expect(result.totalReviews).toBe(0)
    expect(result.overallRatio).toBe(0)
    expect(result.byStars.every(b => b.count === 0)).toBe(true)
  })
})
