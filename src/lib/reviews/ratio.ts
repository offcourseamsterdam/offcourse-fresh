/**
 * Review-to-booking ratio: how many bookings actually turn into a review,
 * broken down by star rating. Not a per-booking match (reviews aren't linked
 * to the specific booking they came from) — a coarse conversion signal:
 * total reviews at each star level against the total count of real bookings.
 */

export interface StarRatioBucket {
  stars: 1 | 2 | 3 | 4 | 5
  count: number
  /** count / bookingsCount, 0 when there are no bookings to divide by */
  ratio: number
}

export interface ReviewBookingRatio {
  bookingsCount: number
  totalReviews: number
  overallRatio: number
  /** Ordered 5 → 1 star */
  byStars: StarRatioBucket[]
}

export function computeReviewToBookingRatio(
  reviews: { rating: number }[],
  bookingsCount: number
): ReviewBookingRatio {
  const counts = new Map<number, number>([[5, 0], [4, 0], [3, 0], [2, 0], [1, 0]])

  for (const review of reviews) {
    const stars = Math.round(review.rating)
    if (stars >= 1 && stars <= 5) {
      counts.set(stars, (counts.get(stars) ?? 0) + 1)
    }
  }

  const byStars: StarRatioBucket[] = [5, 4, 3, 2, 1].map(stars => {
    const count = counts.get(stars) ?? 0
    return {
      stars: stars as StarRatioBucket['stars'],
      count,
      ratio: bookingsCount > 0 ? count / bookingsCount : 0,
    }
  })

  const totalReviews = reviews.length

  return {
    bookingsCount,
    totalReviews,
    overallRatio: bookingsCount > 0 ? totalReviews / bookingsCount : 0,
    byStars,
  }
}
