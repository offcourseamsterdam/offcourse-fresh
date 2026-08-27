/**
 * Branded short links embedded in the post-cruise review SMS. The /r/[code]
 * redirector resolves these to the actual destinations configured in
 * google_reviews_config (recommendations_map_url, tripadvisor_review_url_shared/_private).
 *
 * Single-letter codes ('m'/'t', both already recognized by /r/[code] as
 * aliases for 'map'/'review') — every character here counts twice over on an
 * already-long SMS: once against the segment limit, and the booking id query
 * param on the review link is 36 characters on its own.
 */
export const SITE_MAP_URL = 'https://offcourseamsterdam.com/r/m'
export const SITE_REVIEW_URL = 'https://offcourseamsterdam.com/r/t'

/**
 * Review link for a specific booking. Shared and private cruises are different
 * TripAdvisor listings — /r/[code] resolves which one to redirect to at click
 * time by looking up this booking id's category, so the link embedded in the
 * SMS just needs to carry the id.
 */
export function reviewUrlForBooking(bookingId: string): string {
  return `${SITE_REVIEW_URL}?b=${encodeURIComponent(bookingId)}`
}
