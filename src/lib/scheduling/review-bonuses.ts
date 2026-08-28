import type Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClaude, firstText, CLAUDE_DRAFTER_MODEL } from '@/lib/ai/clients'
import { postDm } from '@/lib/slack/bot'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * The "you were mentioned in a review" Slack DM — shared by the immediate,
 * unambiguous award below and the conflict-confirmation flow
 * (api/admin/reviews/[id]/assign/route.ts), so the message only lives in
 * one place. Respects `slack_notifications_enabled`; no `slack_member_id` or
 * opted out → skip silently, not an error (Beer's rule, §2.2).
 */
export async function sendReviewBonusDm(supabase: AdminClient, staffId: string, rating: number, reviewText: string): Promise<void> {
  const { data: staff } = await supabase.from('staff').select('slack_member_id, slack_notifications_enabled').eq('id', staffId).single()
  if (!staff?.slack_member_id || !staff.slack_notifications_enabled) return
  const stars = '⭐'.repeat(rating)
  await postDm(
    staff.slack_member_id,
    `${stars} A guest mentioned you in a review!\n\n_"${reviewText}"_\n\n€5 added to this month's pay 🎉`,
    { type: 'review-bonus-dm', triggeredBy: 'review-bonuses' },
  )
}

/**
 * Never match on an extracted name shorter than this. 2, not 3 — real short
 * Dutch names exist ("Bo"), and unlike the old regex matcher this is no
 * longer guarding against a blind substring match on ordinary prose; Claude
 * already decided the token is a name. Just enough to reject a single stray
 * character from a malformed response.
 */
const MIN_NAME_LENGTH = 2

interface StaffMember {
  id: string
  name: string
}

function firstNameOf(staff: StaffMember): string {
  return staff.name.trim().split(/\s+/)[0]
}

/**
 * The three match branches below (exact 2+, fuzzy 1, fuzzy 2+) all write the
 * same shape of row to review_bonus_conflicts — only the name and whether an
 * award already happened differ. One helper instead of three inline upserts.
 */
async function flagConflict(supabase: AdminClient, reviewId: string, matchedName: string, candidateIds: string[], awardedStaffId?: string): Promise<void> {
  await supabase.from('review_bonus_conflicts').upsert(
    { review_id: reviewId, matched_name: matchedName, candidate_staff_ids: candidateIds, ...(awardedStaffId ? { awarded_staff_id: awardedStaffId } : {}) },
    { onConflict: 'review_id,matched_name', ignoreDuplicates: true },
  )
}

/**
 * Levenshtein edit distance between two strings (case-sensitive — callers
 * lowercase first). Standard O(n*m) DP table; names are short enough that
 * this never matters for performance.
 */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let i = 0; i < rows; i++) dp[i][0] = i
  for (let j = 0; j < cols; j++) dp[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[rows - 1][cols - 1]
}

/**
 * True when two lowercased names are close enough to be a typo/mishearing of
 * each other, but not identical (identical names go through the exact-match
 * path, never this one). A tighter threshold for short names — one edit on a
 * 4-letter name is proportionally a much bigger change than on a long one.
 *
 * Threshold is based on the LONGER of the two names, not the shorter — a
 * nickname like "Joshy" (5 letters) matched against "Joshua" (6 letters) is
 * a real 2-edit distance (substitute + insert), which a min-length-based
 * threshold of 1 would wrongly reject as too different.
 */
export function isFuzzyNameMatch(a: string, b: string): boolean {
  if (a === b) return false
  const threshold = Math.max(a.length, b.length) <= 5 ? 1 : 2
  return levenshtein(a, b) <= threshold
}

export interface ExtractNamesOptions {
  claude?: Anthropic
}

/**
 * Claude reads the review and returns the PERSON names it actually mentions —
 * judgment a regex cannot do (see review-bonuses.test.ts for the exact
 * failures this replaces: "we will be back" naming a skipper called Will,
 * "we had a beer" naming the founder). Never sees the staff roster and never
 * decides money — matching against real staff and awarding happens entirely
 * in TypeScript afterward, in awardReviewBonuses.
 */
export async function extractMentionedNames(text: string, options: ExtractNamesOptions = {}): Promise<string[]> {
  const claude = options.claude ?? getClaude()
  const response = await claude.messages.create({
    model: CLAUDE_DRAFTER_MODEL,
    max_tokens: 200,
    system:
      'You read customer reviews of a boat cruise company (Off Course Amsterdam). Extract the first names of any REAL PEOPLE mentioned by the reviewer (a skipper, host, guide, or crew member). ' +
      'Do NOT include: boat names (e.g. Diana, Curaçao), place names, company names, or ordinary words that happen to look like names. ' +
      'Return ONLY a JSON array of strings, e.g. ["Joshua"] or ["Sophie","Tariq"]. If no person is named, return []. Return nothing except the JSON array.',
    messages: [{ role: 'user', content: text }],
  })

  try {
    const parsed: unknown = JSON.parse(firstText(response))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((n): n is string => typeof n === 'string' && n.trim().length >= MIN_NAME_LENGTH).map(n => n.trim())
  } catch {
    return []
  }
}

export interface AwardReviewBonusesOptions extends ExtractNamesOptions {
  /** Pre-fetched active staff roster — pass this when scanning many reviews in a loop (see scanReviewsForBonuses) to skip the per-call fetch. */
  staff?: StaffMember[]
}

export interface AwardReviewBonusesResult {
  /**
   * Names Claude extracted that matched NO active staff member, exact or
   * fuzzy — a real person the reviewer named who isn't on the roster at all
   * (as opposed to a guest's own name, or a coincidental word). Surfaced so
   * a human can decide whether to add them as a captain (Beer, 2026-08-22:
   * "if you are missing captains, tell me which, then I approve") — this
   * function only reports them, it never touches the `staff` table itself.
   */
  unmatchedNames: string[]
}

/**
 * Scan a review for staff mentions and award a €5 bonus for each unambiguous
 * match. Two layers, deliberately split along "facts in TypeScript, judgment
 * in Claude": extractMentionedNames decides WHICH WORDS are names (AI
 * judgment); everything below decides WHO they match and whether to pay
 * (deterministic TypeScript — money is never decided by a model).
 *
 * 5 stars only (Beer, 2026-08-22): a named mention in a 4-star-or-below
 * review earns nothing. Returns before even calling Claude, so a sub-5-star
 * review never creates a conflict row either — a conflict exists only to
 * decide WHO gets paid, and below 5 stars nobody does. Also never stamps
 * `bonus_checked_at` — a backfill scan only ever queries 5-star reviews in
 * the first place, so there's nothing to mark "already checked" against.
 *
 * Three match outcomes per mentioned name:
 *   - Exactly one staff member shares the name → award directly.
 *   - Two+ staff share the name → review_bonus_conflicts, no award (existing
 *     behaviour — a human picks).
 *   - No exact match, but exactly one staff member's name is a near-miss
 *     ("Joshy" ≈ Joshua) → Beer's rule: award it AND flag it. The conflict
 *     row's `awarded_staff_id` is set immediately (unlike the case above,
 *     where it's null until resolved) — see
 *     api/admin/reviews/[id]/assign/route.ts, which un-awards the bonus
 *     if a human rejects this speculative match instead of confirming it.
 *
 * Idempotent: UNIQUE constraints on both bonus and conflict tables make
 * re-scanning the same review safe. Called inside `after()` from the
 * Outscraper webhook (and, from 2026-08-22, the GYG review-notification
 * email path, and the manual/backfill scan); all errors are swallowed.
 */
export async function awardReviewBonuses(reviewId: string, text: string, rating: number, options: AwardReviewBonusesOptions = {}): Promise<AwardReviewBonusesResult> {
  const unmatchedNames: string[] = []
  try {
    if (rating < 5) return { unmatchedNames }

    const supabase = createAdminClient()
    // A caller scanning many reviews in one pass (scanReviewsForBonuses)
    // fetches this roster ONCE and passes it in — without options.staff,
    // a loop of N reviews would otherwise re-run this identical query N
    // times (found during the 2026-08-22 153-review backfill).
    const staff = options.staff ?? (await supabase.from('staff').select('id, name').eq('is_active', true)).data
    if (!staff?.length) return { unmatchedNames }

    const mentionedNames = await extractMentionedNames(text, options)

    const alreadyHandled = new Set<string>()
    for (const mentioned of mentionedNames) {
      const key = mentioned.toLowerCase()
      if (alreadyHandled.has(key)) continue
      alreadyHandled.add(key)

      const exactCandidates = staff.filter(s => firstNameOf(s).toLowerCase() === key)
      if (exactCandidates.length === 1) {
        // `.select()` on an ignoreDuplicates upsert returns the row ONLY when
        // it was actually inserted (an `ON CONFLICT DO NOTHING RETURNING *`
        // under the hood) — an empty array means this review was already
        // scanned before. That distinction matters here: without it, a
        // harmless re-scan (a retried webhook, a future backfill) would
        // re-send the "you got €5!" DM every single time, not just once.
        const { data: inserted, error: upsertErr } = await supabase
          .from('review_bonuses')
          .upsert({ staff_id: exactCandidates[0]!.id, review_id: reviewId, amount_cents: 500 }, { onConflict: 'staff_id,review_id', ignoreDuplicates: true })
          .select('staff_id')
        // DM fires here, immediately — unlike the fuzzy-match case below,
        // there's nothing pending to hold it for: an unambiguous exact match
        // is certain the moment it's found.
        if (!upsertErr && inserted?.length) await sendReviewBonusDm(supabase, exactCandidates[0]!.id, rating, text)
        continue
      }
      if (exactCandidates.length > 1) {
        await flagConflict(supabase, reviewId, firstNameOf(exactCandidates[0]!), exactCandidates.map(c => c.id))
        continue
      }

      const fuzzyCandidates = staff.filter(s => isFuzzyNameMatch(key, firstNameOf(s).toLowerCase()))
      if (fuzzyCandidates.length === 1) {
        const match = fuzzyCandidates[0]!
        await supabase.from('review_bonuses').upsert(
          { staff_id: match.id, review_id: reviewId, amount_cents: 500 },
          { onConflict: 'staff_id,review_id', ignoreDuplicates: true },
        )
        await flagConflict(supabase, reviewId, firstNameOf(match), [match.id], match.id)
      } else if (fuzzyCandidates.length > 1) {
        await flagConflict(supabase, reviewId, mentioned, fuzzyCandidates.map(c => c.id))
      } else {
        // No match at all — could be a guest's own name, a name Claude
        // extracted that isn't on the roster, OR a real crew member who just
        // isn't in `staff` yet. Nothing to pay, nothing to flag — but worth
        // reporting, see AwardReviewBonusesResult.
        unmatchedNames.push(mentioned)
      }
    }

    await supabase.from('social_proof_reviews').update({ bonus_checked_at: new Date().toISOString() }).eq('id', reviewId)
    return { unmatchedNames }
  } catch (err) {
    console.error('[review-bonuses] failed:', err instanceof Error ? err.message : err)
    return { unmatchedNames }
  }
}

export interface ScanRow {
  id: string
  reviewText: string | null
  originalText?: string | null
  rating: number
}

export interface ScanRowResult {
  id: string
  unmatchedNames: string[]
}

/** How many awardReviewBonuses calls (each a Claude round trip) run at once. */
const SCAN_CONCURRENCY = 5

/**
 * Runs awardReviewBonuses over many rows in one pass — fetches the active
 * staff roster ONCE up front instead of once per row, and processes rows in
 * small concurrent batches instead of one fully-sequential Claude call at a
 * time (found scanning 153 rows one-by-one during the 2026-08-22 backfill).
 * Shared by the backfill script, the backfill API route, and Withlocals'
 * post-insert scan — the actual matching/awarding logic stays entirely in
 * awardReviewBonuses, this only changes how many rows get fed through it at
 * once.
 */
export async function scanReviewsForBonuses(rows: ScanRow[], options: ExtractNamesOptions = {}): Promise<ScanRowResult[]> {
  const supabase = createAdminClient()
  const { data: staff } = await supabase.from('staff').select('id, name').eq('is_active', true)

  const results: ScanRowResult[] = []
  for (let i = 0; i < rows.length; i += SCAN_CONCURRENCY) {
    const batch = rows.slice(i, i + SCAN_CONCURRENCY)
    const batchResults = await Promise.all(batch.map(async (row): Promise<ScanRowResult> => {
      const text = [row.reviewText, row.originalText].filter(Boolean).join(' ')
      if (!text) return { id: row.id, unmatchedNames: [] }
      const { unmatchedNames } = await awardReviewBonuses(row.id, text, row.rating, { ...options, staff: staff ?? [] })
      return { id: row.id, unmatchedNames }
    }))
    results.push(...batchResults)
  }
  return results
}
