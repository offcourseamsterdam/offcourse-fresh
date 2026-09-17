/**
 * Match quality between a query and one field's text, weakest to strongest.
 * A caller compares these as plain numbers (higher = better) — see rank.ts.
 */
export const MATCH_NONE = 0
export const MATCH_SUBSTRING = 1
export const MATCH_WORD_START = 2
export const MATCH_EXACT = 3

/** Lowercase + strip diacritics, so "curacao" matches "Curaçao". */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Match quality of a single (already-normalized-on-our-side) query against one field. */
export function fieldMatchQuality(query: string, field: string | null | undefined): number {
  if (!field) return MATCH_NONE
  const q = normalize(query).trim()
  if (!q) return MATCH_NONE
  const f = normalize(field)
  if (f === q) return MATCH_EXACT
  const words = f.split(/\s+/)
  if (words.includes(q)) return MATCH_EXACT
  if (words.some(w => w.startsWith(q))) return MATCH_WORD_START
  if (f.includes(q)) return MATCH_SUBSTRING
  return MATCH_NONE
}

/**
 * Match quality of a (possibly multi-word) query against a set of fields — the
 * best quality found across ALL fields for a single-word query, or, for a
 * multi-word query, the weakest per-word quality once every word has matched
 * SOME field (not necessarily the same one) — a query with any unmatched word
 * is MATCH_NONE. This is what lets "viator march" match a Viator record whose
 * title has "march" only in a different field than "viator".
 */
export function matchQuality(query: string, fields: Array<string | null | undefined>): number {
  const q = query.trim()
  if (!q) return MATCH_NONE
  const words = q.split(/\s+/).filter(Boolean)

  const bestAcrossFields = (word: string) =>
    fields.reduce((best, f) => Math.max(best, fieldMatchQuality(word, f)), MATCH_NONE)

  if (words.length <= 1) return bestAcrossFields(q)

  const perWord = words.map(bestAcrossFields)
  if (perWord.some(quality => quality === MATCH_NONE)) return MATCH_NONE
  return Math.min(...perWord)
}
