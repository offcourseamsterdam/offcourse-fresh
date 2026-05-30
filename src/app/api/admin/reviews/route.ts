import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
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
      .order('sort_order', { ascending: true }),
    supabase
      .from('google_reviews_config')
      .select('place_id, place_name, overall_rating, total_reviews, last_synced_at, tripadvisor_url, tripadvisor_rating, tripadvisor_total_reviews')
      .limit(1)
      .maybeSingle(),
  ])

  if (reviewsResult.error) return apiError(reviewsResult.error.message)

  return apiOk({ reviews: reviewsResult.data ?? [], config: configResult.data ?? null })
}

/**
 * PUT /api/admin/reviews — update place_id + tripadvisor_url config.
 * Creates the config row if it doesn't exist yet.
 */
export async function PUT(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const { place_id, tripadvisor_url } = body

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
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'place_id' }
    )

  if (error) return apiError(error.message)
  return apiOk({ updated: true })
}
