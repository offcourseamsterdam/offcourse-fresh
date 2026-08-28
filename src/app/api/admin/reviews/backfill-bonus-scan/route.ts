import { after } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { withRoute } from '@/lib/api/with-route'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { scanReviewsForBonuses } from '@/lib/scheduling/review-bonuses'
import { postSlackDM } from '@/lib/slack/send-notification'

/**
 * POST /api/admin/reviews/backfill-bonus-scan — manually re-trigger the
 * staff-mention scan for any 5-star review that hasn't been checked yet
 * (Beer, 2026-08-22: "pre assign them with the help of AI"). New reviews are
 * already scanned automatically on arrival (Outscraper webhook, GYG email
 * path); this exists for the one-time catch-up on reviews imported before
 * that existed, and for re-running after adding a new staff member whose
 * name might match something in an already-checked review.
 *
 * Fire-and-forget, same shape as the Outscraper webhook's own scan loop —
 * this can genuinely take a few minutes across the full backlog, well past
 * a typical request timeout, so it runs in `after()` and reports via Slack
 * DM when done rather than blocking the response.
 */
export const POST = withRoute(async () => {
  const denied = await requireAdmin()
  if (denied) return denied

  const supabase = createAdminClient()
  const { data: unscanned, error } = await supabase
    .from('social_proof_reviews')
    .select('id, reviewer_name, review_text, original_text, rating')
    .eq('rating', 5)
    .is('bonus_checked_at', null)

  if (error) return apiError(error.message)
  if (!unscanned?.length) return apiOk({ started: false, count: 0 })

  after(async () => {
    const reviewerNameById = new Map(unscanned.map(row => [row.id, row.reviewer_name]))
    const results = await scanReviewsForBonuses(
      unscanned.map(row => ({ id: row.id, reviewText: row.review_text, originalText: row.original_text, rating: row.rating })),
    )
    const unmatched = results
      .filter(r => r.unmatchedNames.length)
      .map(r => ({ reviewerName: reviewerNameById.get(r.id) ?? 'Unknown', names: r.unmatchedNames }))

    const summary = unmatched.length
      ? `Review bonus scan finished — ${unscanned.length} reviews checked. ${unmatched.length} mention a name not on the staff roster:\n` +
        unmatched.map(u => `• "${u.names.join(', ')}" — ${u.reviewerName}'s review`).join('\n')
      : `Review bonus scan finished — ${unscanned.length} reviews checked, no unrecognized names.`
    await postSlackDM(summary).catch(() => {})
  })

  return apiOk({ started: true, count: unscanned.length })
})
