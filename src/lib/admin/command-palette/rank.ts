import type { PaletteItem } from './types'
import { matchQuality, MATCH_NONE } from './match'

/**
 * Higher-weighted groups win ties against lower-weighted groups at equal
 * match quality — this is what lets an exact nav hit for a short page name
 * ("planning") beat a weak partial match elsewhere, while still losing to a
 * genuinely strong record match (see the Diana test in rank.test.ts: a boat
 * named Diana in the nav keywords must not bury a booking for a guest named
 * Diana — that requires the *record* to actually score higher, which a flat
 * "nav always wins" rule can't express).
 */
const GROUP_WEIGHT: Record<string, number> = {
  'Go to': 3,
  Bookings: 2,
  Chats: 2,
  Finance: 2,
  'Partners & promo': 2,
  Cruises: 2,
}
const DEFAULT_GROUP_WEIGHT = 1
const RECENT_BOOST = 0.5
const DEFAULT_MAX_PER_GROUP = 5
/**
 * A hit on `keywords` alone counts for less than a hit on the actual
 * title/subtitle — keywords mean "this is *about* that topic" (a boat named
 * Diana, listed as a keyword on the Boats page), not "this IS that thing".
 * Without this discount, a nav item's synonym list can outrank a genuine
 * record match — see the Diana test in rank.test.ts.
 */
const KEYWORD_MATCH_DISCOUNT = 0.5

export interface RankedItem {
  item: PaletteItem
  score: number
}

/** Best match quality on the item's own title/subtitle, discounted for a keywords-only hit. */
function itemMatchQuality(query: string, item: PaletteItem): number {
  const titleQuality = matchQuality(query, [item.title, item.subtitle])
  if (!item.keywords?.length) return titleQuality
  const keywordQuality = matchQuality(query, item.keywords)
  return Math.max(titleQuality, keywordQuality * KEYWORD_MATCH_DISCOUNT)
}

/**
 * Scores, sorts, and caps-per-group results for a NON-EMPTY query. The
 * empty-query "recents before you type" state is rendered directly from
 * recents.ts — there is nothing to rank yet, so don't call this with `""`.
 */
export function rankItems(
  query: string,
  items: PaletteItem[],
  opts: { recentIds?: Set<string>; maxPerGroup?: number } = {},
): RankedItem[] {
  const recentIds = opts.recentIds ?? new Set<string>()
  const maxPerGroup = opts.maxPerGroup ?? DEFAULT_MAX_PER_GROUP

  const scored: RankedItem[] = []
  for (const item of items) {
    const quality = itemMatchQuality(query, item)
    if (quality === MATCH_NONE) continue
    const groupWeight = GROUP_WEIGHT[item.group] ?? DEFAULT_GROUP_WEIGHT
    const score = quality * groupWeight + (recentIds.has(item.id) ? RECENT_BOOST : 0)
    scored.push({ item, score })
  }

  // Array.prototype.sort is stable in every engine we run on (Node/V8) — ties
  // keep their original (e.g. alphabetical, or source-adapter) order.
  scored.sort((a, b) => b.score - a.score)

  const perGroupCount = new Map<string, number>()
  const capped: RankedItem[] = []
  for (const entry of scored) {
    const count = perGroupCount.get(entry.item.group) ?? 0
    if (count >= maxPerGroup) continue
    perGroupCount.set(entry.item.group, count + 1)
    capped.push(entry)
  }
  return capped
}
