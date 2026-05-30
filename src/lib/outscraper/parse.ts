/**
 * Pure mappers from Outscraper API payloads → social_proof_reviews row shapes.
 * No external calls — testable in isolation.
 *
 * Both Google and TripAdvisor webhook payloads have the same top-level shape:
 *   { id, status, data: [...] }
 *
 * But the inner structure differs:
 *   Google    — data[] contains PLACE objects, each with a reviews_data[] array
 *   TripAdvisor — data[] contains REVIEW objects directly
 */

// ── Row shape (subset of social_proof_reviews insert) ─────────────────────────

export interface ReviewRow {
  external_review_id: string | null
  source: string
  reviewer_name: string
  rating: number
  review_text: string // DB column is NOT NULL — empty string for text-less reviews
  original_text: string | null
  language: string | null
  author_photo_url: string | null
  review_image_url: string | null
  publish_time: string | null // ISO string for timestamptz
  google_profile_url: string | null
  is_active: boolean
}

// ── Place-level aggregates (stored in google_reviews_config) ───────────────────

export interface PlaceMeta {
  overall_rating: number | null
  total_reviews: number | null
}

export interface ParsedPayload {
  reviews: ReviewRow[]
  placeMeta: PlaceMeta
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Parse "MM/DD/YYYY HH:MM:SS" (Google) → ISO datetime string.
 * Returns null on any parse failure.
 */
function parseGoogleDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Format: "03/17/2021 17:08:18"
  const [datePart, timePart] = raw.split(' ')
  if (!datePart) return null
  const [mm, dd, yyyy] = datePart.split('/')
  if (!mm || !dd || !yyyy) return null
  const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}${timePart ? `T${timePart}` : ''}Z`
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Parse "YYYY-MM-DD" (TripAdvisor) → ISO datetime string.
 * Returns null on any parse failure.
 */
function parseTaDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = new Date(`${raw}T00:00:00Z`)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Extract the TripAdvisor review ID from a review_link URL.
 * e.g. "…-r945962867-…" → "945962867"
 * Falls back to the full URL if no match.
 */
function extractTaReviewId(reviewLink: string | null | undefined): string | null {
  if (!reviewLink) return null
  // TripAdvisor review URLs contain "-r<digits>-" (e.g. …-r1035421993-Off_The_…)
  const match = reviewLink.match(/-r(\d+)/)
  return match?.[1] ?? reviewLink
}

// ── Parsers ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGoogleReview(r: Record<string, any>): ReviewRow {
  return {
    // `review_id` is the UNIQUE per-review id. (`reviews_id` is the place-level
    // reviews-collection id — identical across all of a place's reviews.)
    external_review_id: String(r.review_id ?? r.reviews_id ?? ''),
    source: 'google',
    reviewer_name: String(r.author_title ?? 'Anonymous'),
    rating: Number(r.review_rating ?? 0),
    review_text: r.review_text ?? '',
    original_text: null,
    language: 'en',
    author_photo_url: r.author_image ?? null,
    review_image_url: (r.review_img_urls as string[] | undefined)?.[0] ?? r.review_img_url ?? null,
    publish_time: parseGoogleDate(r.review_datetime_utc),
    google_profile_url: r.author_link ?? null,
    is_active: true,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTaReview(r: Record<string, any>): ReviewRow {
  return {
    external_review_id: extractTaReviewId(r.review_link),
    source: 'tripadvisor',
    reviewer_name: String(r.author_title ?? 'Anonymous'),
    rating: Number(r.review_rating ?? 0),
    review_text: r.review_text ?? '',
    original_text: r.review_title ?? null, // TA has a title; store in original_text
    language: null,
    author_photo_url: r.author_image ?? null,
    review_image_url: Array.isArray(r.review_media) ? (r.review_media[0] ?? null) : (r.review_media ?? null),
    publish_time: parseTaDate(r.review_date),
    google_profile_url: r.review_link ?? null, // repurpose field as review permalink
    is_active: true,
  }
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Parse an Outscraper webhook payload for the given source.
 * Handles both Scraper (bulk) and Monitoring (potentially single review) payloads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseOutscraperPayload(payload: Record<string, any>, source: 'google' | 'tripadvisor'): ParsedPayload {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any>[] = Array.isArray(payload.data) ? payload.data : []

  if (source === 'google') {
    // data[] = place objects, each with reviews_data[]
    const placeObj = data[0] ?? {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reviewsData: Record<string, any>[] = Array.isArray(placeObj.reviews_data) ? placeObj.reviews_data : []
    return {
      reviews: reviewsData.map(parseGoogleReview).filter(r => r.external_review_id),
      placeMeta: {
        overall_rating: placeObj.rating != null ? Number(placeObj.rating) : null,
        total_reviews: placeObj.reviews != null ? Number(placeObj.reviews) : null,
      },
    }
  }

  // TripAdvisor: data is nested as [[review, review, …]] — flatten to the review array.
  // (Defensive: .flat() also handles an already-flat [review, …] shape.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flat = (data as any[]).flat() as Record<string, any>[]
  const reviews = flat.map(parseTaReview).filter(r => r.external_review_id)

  // Place-level rating isn't in the payload (per-review `rating` is null), so derive an
  // average from the fetched rows. The place-level `reviews` field gives the real total.
  const rated = reviews.filter(r => r.rating > 0)
  const avgRating = rated.length > 0 ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : null
  const total = flat[0]?.reviews != null ? Number(flat[0].reviews) : null

  return {
    reviews,
    placeMeta: {
      overall_rating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
      total_reviews: total,
    },
  }
}
