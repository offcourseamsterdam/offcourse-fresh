import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth/server'
import { fetchGoogleReviews, searchPlace } from '@/lib/google-reviews/client'
import type { GoogleReview } from '@/lib/google-reviews/client'
import { listAllReviews } from '@/lib/google-reviews/business-profile'
import type { GbpReview } from '@/lib/google-reviews/business-profile'
import { getValidAccessToken } from '@/lib/google-reviews/oauth'

const STAR_TO_NUM: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
}

/**
 * POST /api/admin/reviews/sync-google
 *
 * Preferred path: Business Profile API (OAuth) — fetches ALL reviews with pagination.
 * Fallback path:  Places API (API key) — fetches up to 5 "most relevant" reviews.
 *
 * Deduplication uses the review ID suffix (last segment of the resource name),
 * which is identical whether the record was first synced via Places or GBP.
 */
export async function POST(request: Request) {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const supabase = createAdminClient()

  // ── Try Business Profile API first (OAuth, all reviews) ──────────────────
  try {
    const { accessToken, accountId, locationId } = await getValidAccessToken()
    const { reviews, averageRating, totalReviewCount } = await listAllReviews(
      accessToken,
      accountId,
      locationId,
    )

    const { synced, skipped, errors } = await upsertGbpReviews(supabase, reviews)

    // Update config sync metadata
    await supabase
      .from('google_reviews_config')
      .update({
        overall_rating: averageRating ?? null,
        total_reviews: totalReviewCount ?? null,
        last_synced_at: new Date().toISOString(),
      })
      .not('id', 'is', null)

    return apiOk({
      source: 'business_profile',
      synced,
      skipped,
      total_from_google: reviews.length,
      overall_rating: averageRating,
      total_reviews: totalReviewCount,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // NOT_CONNECTED / REAUTH_REQUIRED → fall through to Places API
    if (msg !== 'NOT_CONNECTED' && msg !== 'REAUTH_REQUIRED') {
      return apiError(`Business Profile API error: ${msg}`, 502)
    }
  }

  // ── Fallback: Places API (API key, max 5 reviews) ─────────────────────────
  let placeId: string | undefined

  try {
    const body = await request.json().catch(() => ({}))
    placeId = body.placeId
  } catch {
    // empty body is fine
  }

  if (!placeId) {
    const { data: config } = await supabase
      .from('google_reviews_config')
      .select('place_id')
      .limit(1)
      .single()
    placeId = config?.place_id
  }

  if (!placeId) placeId = process.env.GOOGLE_PLACE_ID

  if (!placeId) {
    return apiError(
      'No Place ID configured and Google account not connected. ' +
      'Connect your Google Business account in admin settings, or set GOOGLE_PLACE_ID.',
      400,
    )
  }

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
  let synced = 0
  let skipped = 0
  const errors: string[] = []

  for (const review of googleReviews) {
    const reviewId = buildPlacesReviewId(review)
    const reviewText = review.text?.text ?? review.originalText?.text ?? ''
    if (!reviewText || !review.authorAttribution?.displayName) { skipped++; continue }

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

    const idSuffix = reviewId.split('/').pop() ?? reviewId
    const existing = await findExistingReview(supabase, reviewId, idSuffix)

    if (existing) {
      const { error } = await supabase
        .from('social_proof_reviews')
        .update({ review_text: row.review_text, original_text: row.original_text, rating: row.rating, author_photo_url: row.author_photo_url, publish_time: row.publish_time })
        .eq('id', existing.id)
      if (error) errors.push(`Update ${reviewId}: ${error.message}`)
      else synced++
    } else {
      const { error } = await supabase.from('social_proof_reviews').insert(row)
      if (error) errors.push(`Insert ${reviewId}: ${error.message}`)
      else synced++
    }
  }

  // Update config
  const configRow = {
    place_id: placeId,
    place_name: googleData.displayName?.text ?? null,
    overall_rating: googleData.rating ?? null,
    total_reviews: googleData.userRatingCount ?? null,
    last_synced_at: new Date().toISOString(),
  }
  const { data: existingConfig } = await supabase.from('google_reviews_config').select('id').limit(1).single()
  if (existingConfig) {
    await supabase.from('google_reviews_config').update(configRow).eq('id', existingConfig.id)
  } else {
    await supabase.from('google_reviews_config').insert(configRow)
  }

  return apiOk({
    source: 'places_api',
    synced,
    skipped,
    total_from_google: googleReviews.length,
    overall_rating: googleData.rating,
    total_reviews: googleData.userRatingCount,
    note: 'Connect Google Business account to sync all reviews (not just 5).',
    errors: errors.length > 0 ? errors : undefined,
  })
}

// ── GBP upsert helper ────────────────────────────────────────────────────────

async function upsertGbpReviews(
  supabase: ReturnType<typeof createAdminClient>,
  reviews: GbpReview[],
): Promise<{ synced: number; skipped: number; errors: string[] }> {
  let synced = 0
  let skipped = 0
  const errors: string[] = []

  for (const review of reviews) {
    const text = review.comment ?? ''
    if (!text || !review.reviewer.displayName || review.reviewer.isAnonymous) {
      skipped++
      continue
    }

    const idSuffix = review.name.split('/').pop() ?? review.name

    const row = {
      google_review_id: review.name,
      reviewer_name: review.reviewer.displayName,
      review_text: text,
      original_text: text,
      rating: STAR_TO_NUM[review.starRating] ?? 0,
      source: 'google',
      author_photo_url: review.reviewer.profilePhotoUrl ?? null,
      google_profile_url: null,
      publish_time: review.createTime ?? null,
      language: null,
      is_active: true,
    }

    const existing = await findExistingReview(supabase, review.name, idSuffix)

    if (existing) {
      const { error } = await supabase
        .from('social_proof_reviews')
        .update({
          google_review_id: review.name, // upgrade Places format to GBP format
          review_text: row.review_text,
          original_text: row.original_text,
          rating: row.rating,
          author_photo_url: row.author_photo_url,
          publish_time: row.publish_time,
        })
        .eq('id', existing.id)
      if (error) errors.push(`Update ${idSuffix}: ${error.message}`)
      else synced++
    } else {
      const { error } = await supabase.from('social_proof_reviews').insert(row)
      if (error) errors.push(`Insert ${idSuffix}: ${error.message}`)
      else synced++
    }
  }

  return { synced, skipped, errors }
}

/**
 * Find an existing review by exact google_review_id OR by the ID suffix,
 * so reviews originally synced via Places API (different name format) are
 * recognized and updated rather than duplicated.
 */
async function findExistingReview(
  supabase: ReturnType<typeof createAdminClient>,
  fullName: string,
  idSuffix: string,
) {
  const { data: exact } = await supabase
    .from('social_proof_reviews')
    .select('id')
    .eq('google_review_id', fullName)
    .maybeSingle()
  if (exact) return exact

  const { data: suffix } = await supabase
    .from('social_proof_reviews')
    .select('id')
    .ilike('google_review_id', `%${idSuffix}`)
    .maybeSingle()
  return suffix ?? null
}

// ── GET: place search ────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const url = new URL(request.url)
  const query = url.searchParams.get('q')
  if (!query) return apiError('Missing ?q= search query', 400)

  try {
    const result = await searchPlace(query)
    if (!result) return apiOk({ place: null, message: 'No place found for that query' })
    return apiOk({ place: result })
  } catch (err) {
    return apiError(
      `Search failed: ${err instanceof Error ? err.message : String(err)}`,
      502,
    )
  }
}

function buildPlacesReviewId(review: GoogleReview): string {
  if (review.name) return review.name
  return `${review.authorAttribution?.displayName ?? 'anon'}_${review.publishTime ?? Date.now()}`
}
