import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { withRoute } from '@/lib/api/with-route'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendReviewBonusDm } from '@/lib/scheduling/review-bonuses'
import { resolveConversation } from '@/lib/conversations/resolve'

interface Ctx {
  params: Promise<{ id: string }>
}

/**
 * POST /api/admin/reviews/:id/assign — the ONE way to set who a review's €5
 * bonus goes to, for ANY review regardless of how its match status got there
 * (Beer, 2026-08-22, plan §3.2: "generalizes BonusConflictCards rather than
 * sitting beside it"). Replaces the old dedicated
 * /api/admin/reviews/conflicts/[id] route, which only handled a review that
 * already had a pending review_bonus_conflicts row — this handles that case
 * AND a plain reassignment of an exact-match review AND a first-time manual
 * assignment of a "no match" review, through the same code path.
 *
 * Body: { staff_id: string | null } — null clears the assignment.
 */
export const POST = withRoute(async (request: NextRequest, ctx: Ctx) => {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id: reviewId } = await ctx.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const staffId = typeof body.staff_id === 'string' ? body.staff_id : null

  const supabase = createAdminClient()

  // Both fetches only need reviewId — independent, so they run together.
  // On the 404 path this wastes one harmless query; worth it for the win on
  // every other path.
  const [{ data: review, error: reviewErr }, { data: currentBonus }] = await Promise.all([
    supabase.from('social_proof_reviews').select('rating, review_text, conversation_id').eq('id', reviewId).single(),
    supabase.from('review_bonuses').select('staff_id').eq('review_id', reviewId).maybeSingle(),
  ])
  if (reviewErr || !review) return apiError('Review not found', 404)

  const isChange = staffId !== (currentBonus?.staff_id ?? null)

  if (isChange) {
    // A review can only ever have one paid bonus at a time — reassigning
    // Sophie's €5 to Tariq must remove Sophie's row, not just add Tariq's
    // (they'd have different (staff_id, review_id) keys, so upsert alone
    // would leave both).
    if (currentBonus) {
      await supabase.from('review_bonuses').delete().eq('review_id', reviewId).eq('staff_id', currentBonus.staff_id)
    }
    if (staffId) {
      const { error: bonusErr } = await supabase
        .from('review_bonuses')
        .upsert({ staff_id: staffId, review_id: reviewId, amount_cents: 500 }, { onConflict: 'staff_id,review_id', ignoreDuplicates: true })
      if (bonusErr) return apiError(bonusErr.message)
    }
  }

  // Neither write depends on the other's result, so they run together:
  // - If this review still has a pending conflict (two candidates, or a
  //   speculative near-miss award), this decision resolves it too — same
  //   record either way, whether it's a candidate pick or a human
  //   overriding it with someone off the full roster.
  // - Auto-resolve the source conversation (GYG email-ingestion path, §3.2)
  //   — safe unconditionally, since the conflict write above already
  //   resolves every pending conflict this review had.
  await Promise.all([
    supabase
      .from('review_bonus_conflicts')
      .update({ resolved_at: new Date().toISOString(), awarded_staff_id: staffId })
      .eq('review_id', reviewId)
      .is('resolved_at', null),
    review.conversation_id ? resolveConversation(supabase, review.conversation_id) : Promise.resolve(),
  ])

  // DM only on a genuine new assignment — not a no-op re-save of the same
  // staff member, and never on clearing/skipping.
  if (staffId && isChange) {
    await sendReviewBonusDm(supabase, staffId, review.rating, review.review_text)
  }

  return apiOk({ assigned_to: staffId })
})
