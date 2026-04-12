import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createServiceClient } from '@/lib/supabase/server'

/** GET /api/admin/reviews — list all reviews (active + inactive) */
export async function GET() {
  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('social_proof_reviews')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) return apiError(error.message)
  return apiOk({ reviews: data })
}

/** POST /api/admin/reviews — create a manual review */
export async function POST(request: NextRequest) {
  const supabase = await createServiceClient()
  const body = await request.json()

  const row = {
    reviewer_name: body.reviewer_name,
    review_text: body.review_text,
    rating: body.rating ?? 5,
    source: body.source ?? 'manual',
    is_active: body.is_active ?? true,
    sort_order: body.sort_order ?? 0,
    author_photo_url: body.author_photo_url ?? null,
    google_profile_url: body.google_profile_url ?? null,
    publish_time: body.publish_time ?? null,
    language: body.language ?? 'en',
  }

  const { data, error } = await supabase
    .from('social_proof_reviews')
    .insert(row)
    .select()
    .single()

  if (error) return apiError(error.message)
  return apiOk({ review: data })
}
