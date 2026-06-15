import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveExperienceUuid, fetchAllWithlocalsReviews } from './client'
import { parseWithlocalsReview } from './parse'
import { awardReviewBonuses } from '@/lib/scheduling/review-bonuses'

// Two reviews are considered the same if 70%+ of their meaningful words overlap.
const DUPLICATE_THRESHOLD = 0.7

function wordSet(text: string): Set<string> {
  // Only words with 4+ characters to skip filler words ("the", "and", etc.)
  return new Set(text.toLowerCase().match(/\b\w{4,}\b/g) ?? [])
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = wordSet(a)
  const setB = wordSet(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let shared = 0
  for (const w of setA) if (setB.has(w)) shared++
  return shared / new Set([...setA, ...setB]).size
}

export interface SyncWithlocalsResult {
  imported: number
  flagged: number  // possible cross-platform duplicates
  skipped: number  // empty-comment or within-batch duplicate reviews discarded
}

/**
 * Deduplicate within a batch by (reviewer_name, first-50-chars-of-text).
 * Withlocals sometimes imports the same review 3× with different IDs and dates.
 * Keep only the most recent occurrence of each unique (name, text) pair.
 */
function dedupBatch<T extends { reviewer_name: string; review_text: string; publish_time: string | null }>(rows: T[]): T[] {
  const newest = new Map<string, T>()
  // Sort oldest-first so the last write per key is the most recent
  const sorted = [...rows].sort((a, b) => (a.publish_time ?? '').localeCompare(b.publish_time ?? ''))
  for (const row of sorted) {
    const key = `${row.reviewer_name}:::${row.review_text.slice(0, 50)}`
    newest.set(key, row)
  }
  return [...newest.values()]
}

/**
 * Fetch all Withlocals reviews for an experience, run cross-platform duplicate
 * detection, and upsert into social_proof_reviews.
 *
 * New reviews always start with is_active = false so Beer can approve them first.
 * Probable duplicates (same text as a Google/TripAdvisor review) get a
 * possible_duplicate_of pointer so the admin knows what to compare against.
 */
export async function syncWithlocalsReviews(shortId: string): Promise<SyncWithlocalsResult> {
  const supabase = createAdminClient()

  // Resolve the full UUID from the short ID, then fetch all pages
  const experienceUuid = await resolveExperienceUuid(shortId)
  const raw = await fetchAllWithlocalsReviews(experienceUuid)

  // Parse and strip empty-comment reviews
  const parsed = raw.map(parseWithlocalsReview).filter(r => r.review_text.trim().length > 0)

  // Remove within-batch duplicates (same person, same text, multiple dates)
  const rows = dedupBatch(parsed)
  const skipped = raw.length - rows.length

  if (rows.length === 0) return { imported: 0, flagged: 0, skipped }

  // Load all existing non-Withlocals reviews for cross-platform dedup
  const { data: existingReviews } = await supabase
    .from('social_proof_reviews')
    .select('id, review_text')
    .neq('source', 'withlocals')
    .not('review_text', 'is', null)

  // For each incoming review, find a possible duplicate in the existing set
  const enriched = rows.map(row => {
    let possible_duplicate_of: string | null = null
    if (row.review_text && existingReviews) {
      for (const existing of existingReviews) {
        if (!existing.review_text) continue
        if (jaccardSimilarity(row.review_text, existing.review_text) >= DUPLICATE_THRESHOLD) {
          possible_duplicate_of = existing.id
          break
        }
      }
    }
    return { ...row, possible_duplicate_of, updated_at: new Date().toISOString() }
  })

  // Fetch existing Withlocals IDs so we never overwrite is_active on approved reviews
  const { data: existingWLRows } = await supabase
    .from('social_proof_reviews')
    .select('id, external_review_id')
    .eq('source', 'withlocals')

  const existingIdMap = new Map<string, string>(
    (existingWLRows ?? [])
      .filter(r => r.external_review_id)
      .map(r => [r.external_review_id as string, r.id as string])
  )

  const newRows = enriched.filter(r => !existingIdMap.has(r.external_review_id!))

  // Only insert truly new reviews (is_active stays false until Beer approves)
  if (newRows.length > 0) {
    const { error } = await supabase.from('social_proof_reviews').insert(newRows)
    if (error) throw new Error(`Insert failed: ${error.message}`)
  }

  // For existing rows, update only possible_duplicate_of — never touch is_active
  const toFlag = enriched.filter(
    r => existingIdMap.has(r.external_review_id!) && r.possible_duplicate_of != null
  )
  for (const row of toFlag) {
    await supabase
      .from('social_proof_reviews')
      .update({ possible_duplicate_of: row.possible_duplicate_of, updated_at: row.updated_at })
      .eq('id', existingIdMap.get(row.external_review_id!)!)
  }

  const flagged = enriched.filter(r => r.possible_duplicate_of != null).length

  // Run staff-name bonus scanning on newly inserted rows only
  const newExternalIds = newRows
    .map(r => r.external_review_id)
    .filter((id): id is string => id != null)

  if (newExternalIds.length > 0) {
    const { data: inserted } = await supabase
      .from('social_proof_reviews')
      .select('id, review_text, original_text')
      .eq('source', 'withlocals')
      .in('external_review_id', newExternalIds)

    for (const row of inserted ?? []) {
      const text = [row.review_text, row.original_text].filter(Boolean).join(' ')
      await awardReviewBonuses(row.id, text)
    }
  }

  await supabase
    .from('google_reviews_config')
    .update({ last_synced_at: new Date().toISOString() })
    .not('id', 'is', null)

  return { imported: newRows.length, flagged, skipped }
}
