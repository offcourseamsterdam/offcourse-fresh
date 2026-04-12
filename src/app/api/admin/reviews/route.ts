import { apiOk, apiError } from '@/lib/api/response'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/server'

/** GET /api/admin/reviews — list all reviews + GBP connection status (admin only) */
export async function GET() {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const supabase = await createServiceClient()

  // Fetch reviews and config in parallel
  const [reviewsResult, configResult] = await Promise.all([
    supabase
      .from('social_proof_reviews')
      .select('*')
      .order('sort_order', { ascending: true }),
    supabase
      .from('google_reviews_config')
      .select('place_id, place_name, overall_rating, total_reviews, last_synced_at, gbp_account_id, oauth_email, oauth_connected_at')
      .limit(1)
      .single(),
  ])

  if (reviewsResult.error) return apiError(reviewsResult.error.message)

  const config = configResult.data
    ? {
        place_id: configResult.data.place_id,
        place_name: configResult.data.place_name,
        overall_rating: configResult.data.overall_rating,
        total_reviews: configResult.data.total_reviews,
        last_synced_at: configResult.data.last_synced_at,
        is_gbp_connected: Boolean(configResult.data.gbp_account_id && configResult.data.oauth_email),
        oauth_email: configResult.data.oauth_email,
        oauth_connected_at: configResult.data.oauth_connected_at,
      }
    : null

  return apiOk({ reviews: reviewsResult.data, config })
}
