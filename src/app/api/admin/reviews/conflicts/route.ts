import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/reviews/conflicts
 *
 * Returns all pending review bonus conflicts (resolved_at IS NULL).
 * Each conflict includes the review snippet and the candidate staff names
 * so the admin can pick who gets the €5 bonus.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data: conflicts, error } = await supabase
      .from('review_bonus_conflicts')
      .select(`
        id,
        matched_name,
        candidate_staff_ids,
        created_at,
        social_proof_reviews (
          id,
          reviewer_name,
          rating,
          review_text,
          source,
          publish_time
        )
      `)
      .is('resolved_at', null)
      .order('created_at', { ascending: true })

    if (error) return apiError(error.message)

    // Collect all candidate staff IDs across all conflicts.
    const allIds = [...new Set((conflicts ?? []).flatMap(c => c.candidate_staff_ids as string[]))]

    const staffMap = new Map<string, { id: string; name: string; role: string }>()
    if (allIds.length > 0) {
      const { data: staff } = await supabase
        .from('staff')
        .select('id, name, role')
        .in('id', allIds)
      for (const s of staff ?? []) staffMap.set(s.id, s)
    }

    const result = (conflicts ?? []).map(c => ({
      id: c.id,
      matched_name: c.matched_name,
      created_at: c.created_at,
      review: c.social_proof_reviews
        ? {
            id: (c.social_proof_reviews as Record<string, unknown>).id as string,
            reviewer_name: (c.social_proof_reviews as Record<string, unknown>).reviewer_name as string,
            rating: (c.social_proof_reviews as Record<string, unknown>).rating as number,
            review_text: ((c.social_proof_reviews as Record<string, unknown>).review_text as string).slice(0, 300),
            source: (c.social_proof_reviews as Record<string, unknown>).source as string,
            publish_time: (c.social_proof_reviews as Record<string, unknown>).publish_time as string | null,
          }
        : null,
      candidates: (c.candidate_staff_ids as string[])
        .map(id => staffMap.get(id))
        .filter((s): s is { id: string; name: string; role: string } => !!s),
    }))

    return apiOk({ conflicts: result })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load conflicts', 500)
  }
}
