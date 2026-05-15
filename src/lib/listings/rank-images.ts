import { TAG_CATEGORIES, type Tag } from './tags'

// Image ranker for tag-driven listing composition.
//
// Given a listing's tags and a pool of tagged images, picks and orders the
// best N images by tag overlap. Pure function — no DB calls, fully testable.
//
// Scoring (per image):
//   +3 for each audience tag match (audience is the strongest signal)
//   +1 for each other tag match
//   +0.5 × confidence (Gemini's confidence in its labels, 0–1)
//   -0.3 × usage_count (freshness penalty — spreads photos across listings)
//
// Soft boat boost: a listing tagged "diana" prefers Diana-tagged images, but
// won't reject a Curaçao photo with a perfect audience match. The boat tag
// just adds +1 to its score, same as any other tag.
//
// Variety constraint: at most 60% of the selected images may share the same
// audience tag. Prevents a listing from showing 8 photos of the same group.

export interface ImageForRanking {
  id: string
  tags: string[]
  confidence?: number | null
  usage_count?: number | null
}

export interface RankOptions {
  /** How many images to return. Defaults to 8. */
  limit?: number
  /** Max fraction of selected images that may share a single audience tag (0–1). */
  audienceVarietyCap?: number
}

const AUDIENCE_TAG_SET: ReadonlySet<string> = new Set(TAG_CATEGORIES.audience)

function scoreImage(image: ImageForRanking, listingTagSet: ReadonlySet<string>): number {
  let score = 0
  for (const tag of image.tags) {
    if (!listingTagSet.has(tag)) continue
    score += AUDIENCE_TAG_SET.has(tag) ? 3 : 1
  }
  if (image.confidence != null) score += 0.5 * image.confidence
  if (image.usage_count != null) score -= 0.3 * image.usage_count
  return score
}

function primaryAudienceTag(image: ImageForRanking): string | null {
  for (const t of image.tags) {
    if (AUDIENCE_TAG_SET.has(t)) return t
  }
  return null
}

/**
 * Ranks and selects the top-N images for a listing's tag set.
 *
 * @param images   Pool of taggable images (typically the entire library).
 * @param listingTags Tags assigned to the listing being composed.
 * @param options  Tuning knobs: limit, variety cap.
 * @returns Ordered list (best-first), up to `limit` images.
 */
export function rankImagesForListing(
  images: ImageForRanking[],
  listingTags: readonly Tag[] | readonly string[],
  options: RankOptions = {}
): ImageForRanking[] {
  const limit = options.limit ?? 8
  const audienceVarietyCap = options.audienceVarietyCap ?? 0.6
  const listingTagSet = new Set(listingTags)

  // Score every image, drop zero-score images (no tag in common at all).
  const scored = images
    .map((image) => ({ image, score: scoreImage(image, listingTagSet), audience: primaryAudienceTag(image) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // Stable tiebreaker: confidence, then id (deterministic).
      const ca = a.image.confidence ?? 0
      const cb = b.image.confidence ?? 0
      if (cb !== ca) return cb - ca
      return a.image.id.localeCompare(b.image.id)
    })

  // Apply variety constraint: greedy fill with audience cap.
  const maxPerAudience = Math.max(1, Math.floor(limit * audienceVarietyCap))
  const audienceCounts = new Map<string, number>()
  const picked: ImageForRanking[] = []
  const skipped: typeof scored = []

  for (const s of scored) {
    if (picked.length >= limit) break
    if (s.audience) {
      const count = audienceCounts.get(s.audience) ?? 0
      if (count >= maxPerAudience) {
        skipped.push(s)
        continue
      }
      audienceCounts.set(s.audience, count + 1)
    }
    picked.push(s.image)
  }

  // If we couldn't fill `limit` from the constrained pool, top up with skipped
  // (variety preferred but not strict — better to ship 8 photos than 4).
  for (const s of skipped) {
    if (picked.length >= limit) break
    picked.push(s.image)
  }

  return picked
}
