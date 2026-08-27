import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { withRoute } from '@/lib/api/with-route'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/** GET /api/admin/reviews — list all reviews + config */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  const supabase = createAdminClient()

  const [reviewsResult, configResult] = await Promise.all([
    supabase
      .from('social_proof_reviews')
      .select('*')
      .order('publish_time', { ascending: false, nullsFirst: false }),
    supabase
      .from('google_reviews_config')
      .select('place_id, place_name, overall_rating, total_reviews, last_synced_at, tripadvisor_url, tripadvisor_rating, tripadvisor_total_reviews, withlocals_experience_short_id, recommendations_map_url, tripadvisor_review_url_shared, tripadvisor_review_url_private, review_sms_template, review_sms_auto_send, review_sms_enabled')
      .limit(1)
      .maybeSingle(),
  ])

  if (reviewsResult.error) return apiError(reviewsResult.error.message)

  return apiOk({ reviews: reviewsResult.data ?? [], config: configResult.data ?? null })
}

/**
 * PUT /api/admin/reviews — update place_id, review links, and SMS settings.
 * Creates the config row if it doesn't exist yet.
 */
export const PUT = withRoute(async (request: NextRequest) => {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const {
    place_id,
    tripadvisor_url,
    withlocals_experience_short_id,
    recommendations_map_url,
    tripadvisor_review_url_shared,
    tripadvisor_review_url_private,
    review_sms_template,
    review_sms_auto_send,
    review_sms_enabled,
  } = body

  if (!place_id || typeof place_id !== 'string') {
    return apiError('place_id is required', 400)
  }

  const supabase = createAdminClient()

  const { error } = await supabase
    .from('google_reviews_config')
    .upsert(
      {
        place_id: place_id.trim(),
        tripadvisor_url: typeof tripadvisor_url === 'string' ? tripadvisor_url.trim() || null : null,
        withlocals_experience_short_id: typeof withlocals_experience_short_id === 'string' ? withlocals_experience_short_id.trim() || null : null,
        recommendations_map_url: typeof recommendations_map_url === 'string' ? recommendations_map_url.trim() || null : null,
        tripadvisor_review_url_shared: typeof tripadvisor_review_url_shared === 'string' ? tripadvisor_review_url_shared.trim() || null : null,
        tripadvisor_review_url_private: typeof tripadvisor_review_url_private === 'string' ? tripadvisor_review_url_private.trim() || null : null,
        review_sms_template: typeof review_sms_template === 'string' ? review_sms_template.trim() || null : null,
        review_sms_auto_send: typeof review_sms_auto_send === 'boolean' ? review_sms_auto_send : false,
        review_sms_enabled: typeof review_sms_enabled === 'boolean' ? review_sms_enabled : true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'place_id' }
    )

  if (error) return apiError(error.message)
  return apiOk({ updated: true })
})
