import { apiOk, apiError } from '@/lib/api/response'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/server'
import { fetchGoogleReviews, searchPlace } from '@/lib/google-reviews/client'
import type { GoogleReview } from '@/lib/google-reviews/client'

/**
 * POST /api/admin/reviews/sync-google
 *
 * Fetches up to 5 reviews from Google Places API and upserts them into
 * social_proof_reviews. Uses google_review_id for deduplication so the
 * same review is never inserted twice.
 *
 * Body (optional):
 *   { placeId?: string }   — if omitted, uses stored config or GOOGLE_PLACE_ID env var
 */
export async function POST(request: Request) {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const supabase = await createServiceClient()

  // 1. Determine which Place ID to use
  let placeId: string | undefined

  try {
    const body = await request.json().catch(() => ({}))
    placeId = body.placeId
  } catch {
    // empty body is fine
  }

  if (!placeId) {
    // Try stored config first
    const { data: config } = await supabase
      .from('google_reviews_config')
      .select('place_id')
      .limit(1)
      .single()
    placeId = config?.place_id
  }

  if (!placeId) {
    // Fall back to env var
    placeId = process.env.GOOGLE_PLACE_ID
  }

  if (!placeId) {
    return apiError(
      'No Place ID configured. Set GOOGLE_PLACE_ID env var or save a Place ID in admin settings.',
      400,
    )
  }

  // 2. Fetch reviews from Google
  let googleData
  try {
    googleData = await fetchGoogleReviews(placeId)
  } catch (err) {
    return apiError(
      `Failed to fetch from Google: ${err instanceof Error ? err.message : String(err)}`,
      502,
    )
  }

  const googleReviews = googleData.reviews ?? []

  // 3. Upsert each review into social_proof_reviews
  let synced = 0
  let skipped = 0
  const errors: string[] = []

  for (const review of googleReviews) {
    const reviewId = buildGoogleReviewId(review)
    const reviewText = review.text?.text ?? review.originalText?.text ?? ''
    if (!reviewText || !review.authorAttribution?.displayName) {
      skipped++
      continue
    }

    const row = {
      google_review_id: reviewId,
      reviewer_name: review.authorAttribution.displayName,
      review_text: reviewText,
      original_text: review.originalText?.text ?? reviewText,
      rating: review.rating,
      source: 'google',
      author_photo_url: review.authorAttribution.photoUri ?? null,
      google_profile_url: review.authorAttribution.uri ?? null,
      publish_time: review.publishTime ?? null,
      language: review.text?.languageCode ?? review.originalText?.languageCode ?? null,
      is_active: true,
    }

    // Check if review already exists
    const { data: existing } = await supabase
      .from('social_proof_reviews')
      .select('id')
      .eq('google_review_id', reviewId)
      .maybeSingle()

    if (existing) {
      // Update existing review (rating or text might have changed)
      const { error } = await supabase
        .from('social_proof_reviews')
        .update({
          review_text: row.review_text,
          original_text: row.original_text,
          rating: row.rating,
          author_photo_url: row.author_photo_url,
          publish_time: row.publish_time,
        })
        .eq('id', existing.id)
      if (error) errors.push(`Update ${reviewId}: ${error.message}`)
      else synced++
    } else {
      // Insert new review
      const { error } = await supabase
        .from('social_proof_reviews')
        .insert(row)
      if (error) errors.push(`Insert ${reviewId}: ${error.message}`)
      else synced++
    }
  }

  // 4. Update config with sync metadata
  const configRow = {
    place_id: placeId,
    place_name: googleData.displayName?.text ?? null,
    overall_rating: googleData.rating ?? null,
    total_reviews: googleData.userRatingCount ?? null,
    last_synced_at: new Date().toISOString(),
  }

  const { data: existingConfig } = await supabase
    .from('google_reviews_config')
    .select('id')
    .limit(1)
    .single()

  if (existingConfig) {
    const { error: configError } = await supabase
      .from('google_reviews_config')
      .update(configRow)
      .eq('id', existingConfig.id)
    if (configError) errors.push(`Config update: ${configError.message}`)
  } else {
    const { error: configError } = await supabase
      .from('google_reviews_config')
      .insert(configRow)
    if (configError) errors.push(`Config insert: ${configError.message}`)
  }

  return apiOk({
    synced,
    skipped,
    total_from_google: googleReviews.length,
    overall_rating: googleData.rating,
    total_reviews: googleData.userRatingCount,
    errors: errors.length > 0 ? errors : undefined,
  })
}

/**
 * POST /api/admin/reviews/sync-google?action=search
 * Search for a place to get its Place ID.
 *
 * We handle this via the same route but with a query param.
 */
export async function GET(request: Request) {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const url = new URL(request.url)
  const query = url.searchParams.get('q')

  if (!query) {
    return apiError('Missing ?q= search query', 400)
  }

  try {
    const result = await searchPlace(query)
    if (!result) {
      return apiOk({ place: null, message: 'No place found for that query' })
    }
    return apiOk({ place: result })
  } catch (err) {
    return apiError(
      `Search failed: ${err instanceof Error ? err.message : String(err)}`,
      502,
    )
  }
}

/** Build a stable ID for deduplication from a Google review object */
function buildGoogleReviewId(review: GoogleReview): string {
  // Use the resource name if available, otherwise hash author + publish time
  if (review.name) return review.name
  return `${review.authorAttribution?.displayName ?? 'anon'}_${review.publishTime ?? Date.now()}`
}
