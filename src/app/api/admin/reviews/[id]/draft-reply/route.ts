import { apiOk, apiError } from '@/lib/api/response'
import { withRoute } from '@/lib/api/with-route'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { draftReviewReply } from '@/lib/reviews/draft-reply'

interface Ctx {
  params: Promise<{ id: string }>
}

/**
 * POST /api/admin/reviews/:id/draft-reply — generate (or regenerate) a
 * copy-paste reply for a review (Beer, 2026-08-22, plan Phase 4). No
 * platform gets auto-posted to — the draft is saved on the review row and a
 * human pastes it into that platform's own dashboard.
 */
export const POST = withRoute(async (_request: Request, ctx: Ctx) => {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id: reviewId } = await ctx.params
  const supabase = createAdminClient()

  const { data: review, error: reviewErr } = await supabase
    .from('social_proof_reviews')
    .select('reviewer_name, review_text, rating, source')
    .eq('id', reviewId)
    .single()
  if (reviewErr || !review) return apiError('Review not found', 404)
  if (!review.review_text) return apiError('This review has no text to reply to', 400)
  // Withlocals has no reply mechanism at all — not just no API, no dashboard
  // reply feature either (Beer, 2026-08-22) — so there is nowhere to paste a
  // draft. Enforced here too, not just hidden in the UI, same as every other
  // business rule in this codebase's money/content paths.
  if (review.source === 'withlocals') return apiError('Withlocals has no reply feature to draft for', 400)

  // Recent drafts across ANY review/platform, so Claude doesn't reuse the
  // same phrasing twice in a row — same de-dup shape as the old Google-only
  // reply generator, just no longer scoped to one platform.
  const { data: recentRows } = await supabase
    .from('social_proof_reviews')
    .select('ai_draft_reply')
    .not('ai_draft_reply', 'is', null)
    .neq('id', reviewId)
    .order('created_at', { ascending: false })
    .limit(5)
  const recentReplies = (recentRows ?? []).map(r => r.ai_draft_reply).filter((r): r is string => !!r)

  let draft: string
  try {
    draft = await draftReviewReply({
      platform: review.source,
      reviewerName: review.reviewer_name,
      reviewText: review.review_text,
      rating: review.rating,
      recentReplies,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to draft a reply', 502)
  }

  const { error: saveErr } = await supabase
    .from('social_proof_reviews')
    .update({ ai_draft_reply: draft })
    .eq('id', reviewId)
  if (saveErr) return apiError(saveErr.message)

  return apiOk({ draft })
})
