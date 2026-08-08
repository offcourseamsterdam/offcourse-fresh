import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ReviewRow } from '@/lib/outscraper/parse'

const GYG_URL = 'https://www.getyourguide.com/en-gb/amsterdam-l36/amsterdam-hidden-gems-canal-cruise-t1020291/'

/**
 * Maps a GYG product's exact display name (as it appears in their "new
 * review" notification email, see detect-review-notification.ts) to that
 * product's own activity page URL, for reactively re-syncing just-reviewed
 * products immediately instead of waiting for the weekly cron. Grown one
 * real product at a time, same discipline as lib/ota/detect.ts.
 *
 * "Private Canal Cruise Through Amsterdam's Hidden Gems" was originally
 * (wrongly) assumed to be GYG_URL/t1020291 above — Beer confirmed the real
 * page (2026-08-08): it's actually t1411454, a DIFFERENT product. GYG_URL
 * itself is "Small Shared Canal Cruise with Local Captain and Hidden Gems".
 * Both URLs came to us as GYG's own "preview" links (a `?preview=TOKEN`
 * query param, used for previewing an unpublished listing as its owner) —
 * stripped here since the reactive fetch below has no session/auth and the
 * canonical published URL is what actually serves the public JSON-LD this
 * code parses.
 */
const GYG_PRIVATE_CANAL_CRUISE_URL =
  'https://www.getyourguide.com/en-gb/amsterdam-l36/private-canal-cruise-through-amsterdam-s-hidden-gems-t1411454/'

export const GYG_PRODUCT_URLS: Record<string, string> = {
  "Private Canal Cruise Through Amsterdam's Hidden Gems": GYG_PRIVATE_CANAL_CRUISE_URL,
  'Small Shared Canal Cruise with Local Captain and Hidden Gems': GYG_URL,
}

export interface SyncGYGResult {
  imported: number
  skipped: number
  blocked: boolean
}

// Parse "June 8, 2026" → ISO string
function parseGYGDate(raw: string): string | null {
  try {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d.toISOString()
  } catch {
    return null
  }
}

function detectLanguage(text: string): string {
  // Simple heuristic: if text contains non-ASCII chars or Dutch keywords, mark nl
  if (/[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/i.test(text)) return 'nl'
  if (/\b(een|aanrader|gezellig|boot|leuk|kapitein|echt)\b/i.test(text)) return 'nl'
  return 'en'
}

/**
 * Fetch GYG reviews from their JSON-LD structured data.
 * GYG's initial HTML contains review schema markup, so no JS rendering needed.
 * Falls back gracefully if Cloudflare blocks the request.
 *
 * `url` defaults to the main tracked product (the weekly cron's own call
 * never passes one) — pass a specific product's URL to resync just that one
 * reactively, see gmail/sync.ts's GYG review-notification handling.
 */
export async function syncGYGReviews(url: string = GYG_URL): Promise<SyncGYGResult> {
  const supabase = createAdminClient()

  // Attempt to fetch the GYG page with browser-like headers
  let html: string
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      next: { revalidate: 0 },
    })
    html = await res.text()
  } catch {
    return { imported: 0, skipped: 0, blocked: true }
  }

  // Detect Cloudflare/GYG block
  if (html.includes('GetYourGuide – Error') || html.includes('cf-browser-verification') || !html.includes('reviewBody')) {
    return { imported: 0, skipped: 0, blocked: true }
  }

  // Extract JSON-LD review blocks
  const ldMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? []
  const reviews: Array<{ name: string; rating: number; text: string; date: string }> = []

  for (const block of ldMatches) {
    try {
      const content = block.replace(/<script[^>]*>/, '').replace('</script>', '')
      const data = JSON.parse(content)
      const rawReviews = data.review ?? []
      for (const r of rawReviews) {
        if (r.reviewBody && r.author?.name && r.reviewRating?.ratingValue) {
          reviews.push({
            name: r.author.name,
            rating: Math.round(r.reviewRating.ratingValue),
            text: r.reviewBody.trim(),
            date: r.datePublished ?? '',
          })
        }
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }

  if (reviews.length === 0) return { imported: 0, skipped: 0, blocked: false }

  // Load existing GYG external IDs
  const { data: existing } = await supabase
    .from('social_proof_reviews')
    .select('external_review_id')
    .eq('source', 'getyourguide')

  const existingIds = new Set((existing ?? []).map(r => r.external_review_id).filter(Boolean))

  const newRows: ReviewRow[] = []
  for (const r of reviews) {
    const dateSlug = r.date.slice(0, 10).replace(/-/g, '')
    const extId = `gyg_${r.name.replace(/\s+/g, '_')}_${dateSlug}`
    if (existingIds.has(extId)) continue

    newRows.push({
      external_review_id: extId,
      source: 'getyourguide',
      reviewer_name: r.name,
      rating: r.rating,
      review_text: r.text,
      original_text: null,
      language: detectLanguage(r.text),
      author_photo_url: null,
      review_image_url: null,
      publish_time: parseGYGDate(r.date),
      google_profile_url: null,
      is_active: false,
    })
  }

  const skipped = reviews.length - newRows.length

  if (newRows.length > 0) {
    const { error } = await supabase.from('social_proof_reviews').insert(newRows)
    if (error) throw new Error(`GYG insert failed: ${error.message}`)
  }

  return { imported: newRows.length, skipped, blocked: false }
}
