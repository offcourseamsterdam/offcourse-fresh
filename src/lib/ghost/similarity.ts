/**
 * Pure, client-safe heuristic for "did the Ghost's draft match what you sent?".
 * Token (Jaccard) overlap — no network, no server imports — so the Ghost page
 * can render an at-a-glance badge on every corrected proposal. The deeper
 * "what exactly changed" explanation is the AI call in compare.ts.
 */

export type SimilarityLabel = 'match' | 'minor' | 'different'

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'is', 'are', 'for', 'you', 'we', 'i', 'it'])

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP.has(w)),
  )
}

export function replySimilarity(draft: string, actual: string): { ratio: number; label: SimilarityLabel } {
  const a = tokens(draft)
  const b = tokens(actual)
  if (a.size === 0 && b.size === 0) return { ratio: 1, label: 'match' }
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  const union = a.size + b.size - shared
  const ratio = union === 0 ? 1 : shared / union
  const label: SimilarityLabel = ratio >= 0.6 ? 'match' : ratio >= 0.3 ? 'minor' : 'different'
  return { ratio: Math.round(ratio * 100) / 100, label }
}
