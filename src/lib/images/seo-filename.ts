import { slugify } from '@/lib/utils'

const MAX_LENGTH = 60
const FALLBACK = 'image'

/**
 * Build an SEO-friendly base filename from AI-generated keywords.
 *
 * Rules:
 * - Lowercase, hyphen-separated, ASCII only
 * - Max 60 chars (Google indexes filenames up to ~70-80 reliably)
 * - Deduplicates keyword fragments
 * - Falls back to "image" when keywords are empty
 *
 * The returned string is the BASE filename — variant suffix and extension
 * are appended later (e.g. "amsterdam-canal-cruise" → "amsterdam-canal-cruise_640.avif").
 */
export function buildSeoFilename(keywords: readonly string[]): string {
  if (!keywords || keywords.length === 0) return FALLBACK

  const seen = new Set<string>()
  const parts: string[] = []

  for (const keyword of keywords) {
    const slug = slugify(keyword)
    if (!slug) continue

    for (const fragment of slug.split('-')) {
      if (!fragment || seen.has(fragment)) continue
      seen.add(fragment)
      parts.push(fragment)
    }
  }

  if (parts.length === 0) return FALLBACK

  let filename = parts.join('-')
  if (filename.length <= MAX_LENGTH) return filename

  // Truncate at the last hyphen before the limit so we never cut mid-word
  filename = filename.slice(0, MAX_LENGTH)
  const lastHyphen = filename.lastIndexOf('-')
  if (lastHyphen > 0) filename = filename.slice(0, lastHyphen)
  return filename || FALLBACK
}
