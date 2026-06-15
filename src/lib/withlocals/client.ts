import 'server-only'

const BASE = 'https://api.withlocals.com/api/v1'

// Mimic a browser — Withlocals' API is public but rejects non-browser user-agents.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, */*',
  'Origin': 'https://www.withlocals.com',
  'Referer': 'https://www.withlocals.com/',
}

export interface WithlocalsReview {
  id: string
  experience_id: string
  title: string | null
  comment: string | null
  guest_name: string | null
  guest_picture: string | null
  guest_country_iso: string | null
  guest_country_name: string | null
  rating: number
  scale: number
  detected_language: string | null
  created: string
}

/**
 * Resolve the full experience UUID from a short ID (the 8-char hex suffix of
 * the Withlocals URL slug). Returns the UUID on the first review for that short ID.
 */
export async function resolveExperienceUuid(shortId: string): Promise<string> {
  const url = new URL(`${BASE}/review/by-experience-short-ids`)
  url.searchParams.set('ids', shortId)
  url.searchParams.set('lang', 'en')
  url.searchParams.set('maxCommentLength', '1')
  url.searchParams.set('limit', '1')

  const res = await fetch(url.toString(), { headers: HEADERS, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Withlocals short-ID lookup returned ${res.status}`)

  const data = await res.json() as WithlocalsReview[]
  if (!Array.isArray(data) || data.length === 0) throw new Error(`No reviews found for short ID "${shortId}"`)

  const uuid = data[0].experience_id
  if (!uuid) throw new Error(`Could not resolve UUID for short ID "${shortId}"`)
  return uuid
}

/** Fetch one page of reviews for a full experience UUID. */
async function fetchPage(experienceUuid: string, from: number, limit: number): Promise<WithlocalsReview[]> {
  const url = new URL(`${BASE}/review/experience/${encodeURIComponent(experienceUuid)}`)
  url.searchParams.set('language', 'en')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('from', String(from))
  url.searchParams.set('maxCommentLength', '9999')

  const res = await fetch(url.toString(), {
    headers: HEADERS,
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: 0 },
  })

  if (!res.ok) throw new Error(`Withlocals reviews API returned ${res.status}`)
  const data = await res.json() as unknown
  if (!Array.isArray(data)) throw new Error('Unexpected Withlocals API response shape')
  return data as WithlocalsReview[]
}

/**
 * Fetch ALL reviews for an experience, paginating automatically.
 * Uses the full experience UUID (resolved from the short ID if needed).
 */
export async function fetchAllWithlocalsReviews(experienceUuid: string): Promise<WithlocalsReview[]> {
  const PAGE = 100
  const all: WithlocalsReview[] = []
  let from = 0

  while (true) {
    const batch = await fetchPage(experienceUuid, from, PAGE)
    all.push(...batch)
    if (batch.length < PAGE) break
    from += PAGE
  }

  return all
}
