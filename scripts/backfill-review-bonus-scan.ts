/**
 * One-time catch-up: run the staff-mention matcher over every 5-star review
 * that predates the feature (2026-08-22) — same query and shared scan helper
 * as POST /api/admin/reviews/backfill-bonus-scan, run directly here instead
 * of through the deployed route so it isn't bound by a request timeout.
 * Re-runnable — only touches rows where bonus_checked_at IS NULL.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json --import ./scripts/_preload-env.mjs scripts/backfill-review-bonus-scan.ts
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { scanReviewsForBonuses } from '@/lib/scheduling/review-bonuses'

async function main() {
  const supabase = createAdminClient()
  const { data: unscanned, error } = await supabase
    .from('social_proof_reviews')
    .select('id, reviewer_name, review_text, original_text, rating, source')
    .eq('rating', 5)
    .is('bonus_checked_at', null)

  if (error) throw new Error(error.message)
  if (!unscanned?.length) {
    console.log('Nothing to scan — every 5-star review already has bonus_checked_at set.')
    return
  }

  console.log(`Scanning ${unscanned.length} review(s)...`)

  const reviewById = new Map(unscanned.map(row => [row.id, row]))
  const results = await scanReviewsForBonuses(
    unscanned.map(row => ({ id: row.id, reviewText: row.review_text, originalText: row.original_text, rating: row.rating })),
  )
  const unmatched = results
    .filter(r => r.unmatchedNames.length)
    .map(r => ({ ...reviewById.get(r.id)!, names: r.unmatchedNames }))

  // All-time totals, not just this run's delta — same wording the admin
  // Reviews tab uses ("X total bonuses on record").
  const { data: bonuses } = await supabase.from('review_bonuses').select('id')
  const { data: conflicts } = await supabase.from('review_bonus_conflicts').select('id')

  console.log(`\nDone. ${unscanned.length} reviews checked.`)
  console.log(`Total bonuses on record: ${bonuses?.length ?? 0}. Total conflicts (needing confirmation, all-time): ${conflicts?.length ?? 0}.`)

  if (unmatched.length) {
    console.log(`\n${unmatched.length} review(s) mention a name that matched NO active staff member:`)
    for (const u of unmatched) {
      console.log(`  - "${u.names.join(', ')}" — ${u.reviewer_name}'s ${u.source} review`)
    }
  } else {
    console.log('\nNo unrecognized names — every mentioned name matched (or fuzzy-matched) an active staff member.')
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Backfill FAILED:', err)
    process.exit(1)
  })
