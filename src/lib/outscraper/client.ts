import 'server-only'
import { env } from '@/env'

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.app.outscraper.com'

/** Newest 40 reviews per on-demand scrape — plenty for Off Course's volume. */
const REVIEWS_LIMIT = 40

// ── Types ────────────────────────────────────────────────────────────────────

export interface OutscraperJobResponse {
  id: string
  status: 'Pending' | 'Success' | 'Error'
}

// ── Internal request helper ───────────────────────────────────────────────────

async function request(path: string, params: Record<string, string | number | boolean>): Promise<OutscraperJobResponse> {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v))
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'X-API-Key': env.OUTSCRAPER_API_KEY ?? '' },
    signal: AbortSignal.timeout(15_000), // async endpoint responds quickly (job is queued)
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Outscraper API error ${res.status}: ${text.slice(0, 200)}`)
  }

  return res.json() as Promise<OutscraperJobResponse>
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Kick off an async Google Maps Reviews scrape for a given place.
 * Results are delivered to `webhookUrl` as a POST when the job completes.
 *
 * @param placeId  Google place_id (ChIJ…) or google_id (0x886…)
 * @param webhookUrl  Full URL of our webhook endpoint
 */
export async function scrapeGoogleReviews({
  placeId,
  webhookUrl,
}: {
  placeId: string
  webhookUrl: string
}): Promise<OutscraperJobResponse> {
  return request('/maps/reviews-v3', {
    query: placeId,
    reviewsLimit: REVIEWS_LIMIT,
    sort: 'newest',
    language: 'en',
    async: true,
    webhook: webhookUrl,
  })
}

/**
 * Kick off an async TripAdvisor Reviews scrape for a given listing URL.
 * Results are delivered to `webhookUrl` as a POST when the job completes.
 *
 * @param listingUrl  Full TripAdvisor page URL for the business
 * @param webhookUrl  Full URL of our webhook endpoint
 */
export async function scrapeTripadvisorReviews({
  listingUrl,
  webhookUrl,
}: {
  listingUrl: string
  webhookUrl: string
}): Promise<OutscraperJobResponse> {
  return request('/tripadvisor-reviews', {
    query: listingUrl,
    limit: REVIEWS_LIMIT,
    async: true,
    webhook: webhookUrl,
  })
}
