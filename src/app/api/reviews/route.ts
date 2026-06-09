import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk } from '@/lib/api/response'

// Cache for 5 minutes — reviews change infrequently (daily Outscraper sync at most).
export const revalidate = 300

/**
 * GET /api/reviews
 *
 * Public endpoint — returns all active reviews for the "See all reviews" modal.
 * The homepage only pre-loads 20 for the slider; the modal fetches the full set here.
 *
 * Returns: { ok: true, data: ReviewsModalReview[] }
 */
export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('social_proof_reviews')
    .select('id, reviewer_name, rating, source, author_photo_url, review_image_url, publish_time, review_text')
    .eq('is_active', true)
    .order('publish_time', { ascending: false, nullsFirst: false })
    .limit(1000)

  if (error) {
    // Fail gracefully — the modal already has the pre-loaded reviews as fallback
    return apiOk([])
  }

  return apiOk(data ?? [])
}
