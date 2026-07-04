import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/admin/reviews/conflicts/[id]
 *
 * Resolve a bonus conflict. Body: { staff_id: string | null }
 *   - staff_id set → award the €5 bonus to that person and mark resolved
 *   - staff_id null → skip (no bonus awarded) and mark resolved
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const staffId = typeof body.staff_id === 'string' ? body.staff_id : null

    const supabase = createAdminClient()

    // Fetch the conflict to get review_id and validate candidate_staff_ids.
    const { data: conflict, error: fetchErr } = await supabase
      .from('review_bonus_conflicts')
      .select('id, review_id, candidate_staff_ids, resolved_at')
      .eq('id', id)
      .single()

    if (fetchErr || !conflict) return apiError('Conflict not found', 404)
    if (conflict.resolved_at) return apiError('Already resolved', 409)

    if (staffId !== null) {
      const candidates = conflict.candidate_staff_ids as string[]
      if (!candidates.includes(staffId)) return apiError('staff_id is not a candidate for this conflict', 400)

      // Award the bonus — idempotent if somehow already exists.
      const { error: bonusErr } = await supabase.from('review_bonuses').upsert(
        { staff_id: staffId, review_id: conflict.review_id, amount_cents: 500 },
        { onConflict: 'staff_id,review_id', ignoreDuplicates: true },
      )
      if (bonusErr) return apiError(bonusErr.message)
    }

    // Mark the conflict as resolved.
    const { error: resolveErr } = await supabase
      .from('review_bonus_conflicts')
      .update({ resolved_at: new Date().toISOString(), awarded_staff_id: staffId })
      .eq('id', id)

    if (resolveErr) return apiError(resolveErr.message)
    return apiOk({ resolved: true, awarded_to: staffId })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to resolve conflict', 500)
  }
}
