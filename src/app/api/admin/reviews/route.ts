import { apiOk, apiError } from '@/lib/api/response'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/server'

/** GET /api/admin/reviews — list all reviews (admin only) */
export async function GET() {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('social_proof_reviews')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) return apiError(error.message)
  return apiOk({ reviews: data })
}
