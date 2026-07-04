import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/** GET /api/admin/scheduling/staff/[id]/bonuses — all review bonuses for one staff member. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('review_bonuses')
      .select(`
        id,
        amount_cents,
        awarded_at,
        social_proof_reviews (
          id,
          reviewer_name,
          rating,
          review_text,
          source,
          publish_time
        )
      `)
      .eq('staff_id', id)
      .order('awarded_at', { ascending: false })

    if (error) return apiError(error.message)

    const bonuses = (data ?? []).map(b => ({
      id: b.id,
      amount_cents: b.amount_cents,
      awarded_at: b.awarded_at,
      review: b.social_proof_reviews
        ? {
            id: (b.social_proof_reviews as Record<string, unknown>).id as string,
            reviewer_name: (b.social_proof_reviews as Record<string, unknown>).reviewer_name as string,
            rating: (b.social_proof_reviews as Record<string, unknown>).rating as number,
            review_text: ((b.social_proof_reviews as Record<string, unknown>).review_text as string).slice(0, 200),
            source: (b.social_proof_reviews as Record<string, unknown>).source as string,
            publish_time: (b.social_proof_reviews as Record<string, unknown>).publish_time as string | null,
          }
        : null,
    }))

    const total_cents = bonuses.reduce((sum, b) => sum + b.amount_cents, 0)
    return apiOk({ bonuses, total_cents })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load bonuses', 500)
  }
}
