import { createAdminClient } from '@/lib/supabase/admin'

/** Skip first names shorter than this to avoid false positives. */
const MIN_NAME_LENGTH = 3

/**
 * Staff first names that are ALSO common English/Dutch words. These fire on
 * ordinary review prose ("we will be back", "what a treat", "I hope to return"),
 * so a bare whole-word match is not enough to auto-pay. For these names we only
 * auto-award when a role word corroborates that the review is talking about the
 * person; otherwise the match goes to human review (a single-candidate conflict).
 *
 * Curated, lowercased, and extend as the roster grows — extra entries are
 * harmless because they only bite when a staffer actually holds that name.
 */
const COMMON_WORD_NAMES = new Set([
  'will', 'mark', 'grace', 'may', 'hope', 'rose', 'joy', 'art', 'bill',
  'dawn', 'faith', 'summer', 'sunny', 'guy', 'rich', 'sky', 'star',
  // Founder name + the word reviews of a canal-drinks cruise mention most.
  'beer',
])

/**
 * Words that signal the review is naming a crew member, in the languages reviews
 * actually arrive in. Their presence near a common-word name is strong enough to
 * auto-award (e.g. "Will, our skipper, was great").
 */
const ROLE_WORDS = [
  'skipper', 'captain', 'host', 'hostess', 'crew', 'guide', // EN
  'schipper', 'kapitein', 'gastheer', 'gastvrouw', 'bemanning', // NL
]

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when any role word appears as a whole word in the review text. */
function hasRoleWord(text: string): boolean {
  return ROLE_WORDS.some(w => new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(text))
}

/**
 * Scan review text for active staff first names and award a €5 bonus for each
 * unambiguous match. When two staff share the same first name and it appears in
 * a review, a `review_bonus_conflicts` row is created instead — the admin
 * resolves it manually on the Reviews page.
 *
 * Idempotent: UNIQUE constraints on both bonus and conflict tables make
 * re-scanning the same review safe. Called inside `after()` from the
 * Outscraper webhook; all errors are swallowed.
 */
export async function awardReviewBonuses(reviewId: string, text: string): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { data: staff } = await supabase
      .from('staff')
      .select('id, name')
      .eq('is_active', true)

    if (!staff?.length) return

    // Build a map from lowercased first name → all staff who share it.
    const byFirstName = new Map<string, { id: string; name: string }[]>()
    for (const member of staff) {
      const firstName = member.name.trim().split(/\s+/)[0]
      if (!firstName || firstName.length < MIN_NAME_LENGTH) continue
      const key = firstName.toLowerCase()
      const arr = byFirstName.get(key) ?? []
      arr.push(member)
      byFirstName.set(key, arr)
    }

    for (const [key, candidates] of byFirstName) {
      const pattern = new RegExp(`\\b${escapeRegex(key)}\\b`, 'i')
      if (!pattern.test(text)) continue

      if (candidates.length === 1) {
        // A first name that's also a common word ("Will", "Grace", "May") fires
        // on ordinary review prose. Only auto-award when a role word corroborates
        // the mention; otherwise route it to human review instead of silently
        // paying — same conflict surface as the two-staff case, one candidate.
        if (COMMON_WORD_NAMES.has(key) && !hasRoleWord(text)) {
          await supabase.from('review_bonus_conflicts').upsert(
            {
              review_id: reviewId,
              matched_name: candidates[0].name.trim().split(/\s+/)[0],
              candidate_staff_ids: [candidates[0].id],
            },
            { onConflict: 'review_id,matched_name', ignoreDuplicates: true },
          )
        } else {
          // Unambiguous — award the bonus directly.
          await supabase.from('review_bonuses').upsert(
            { staff_id: candidates[0].id, review_id: reviewId, amount_cents: 500 },
            { onConflict: 'staff_id,review_id', ignoreDuplicates: true },
          )
        }
      } else {
        // Multiple staff share this first name — raise a conflict for the admin.
        // Display-friendly name from the first candidate (all share the same first name).
        const displayName = candidates[0].name.trim().split(/\s+/)[0]
        await supabase.from('review_bonus_conflicts').upsert(
          {
            review_id: reviewId,
            matched_name: displayName,
            candidate_staff_ids: candidates.map(c => c.id),
          },
          { onConflict: 'review_id,matched_name', ignoreDuplicates: true },
        )
      }
    }
  } catch (err) {
    console.error('[review-bonuses] failed:', err instanceof Error ? err.message : err)
  }
}
