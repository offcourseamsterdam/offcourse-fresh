import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeGoogleReviews, scrapeTripadvisorReviews } from '@/lib/outscraper/client'
import { outscraperWebhookToken } from '@/lib/outscraper/webhook-token'
import { syncWithlocalsReviews } from '@/lib/withlocals/sync'
import { env } from '@/env'

/**
 * POST /api/admin/reviews/sync
 *
 * Kicks off async Outscraper scrape jobs for Google and/or TripAdvisor.
 * Results are delivered asynchronously to /api/webhooks/outscraper.
 * Returns immediately with { started: true } — do NOT wait for results.
 *
 * Skips a source gracefully when its config is not set (no place_id / no tripadvisor_url).
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const apiKey = env.OUTSCRAPER_API_KEY
  if (!apiKey) return apiError('OUTSCRAPER_API_KEY is not configured', 503)

  const supabase = createAdminClient()
  const { data: config } = await supabase
    .from('google_reviews_config')
    .select('place_id, tripadvisor_url, withlocals_experience_short_id')
    .limit(1)
    .single()

  if (!config) return apiError('Reviews not configured — set place_id first', 422)

  // Build the webhook callback from the host the admin is actually on (e.g. www.…).
  // NEXT_PUBLIC_SITE_URL is the apex, which 308-redirects to www — and Outscraper's
  // webhook POST does NOT follow redirects, so the apex would silently drop results.
  const host = request.headers.get('host')
  const siteUrl = host ? `https://${host}` : env.NEXT_PUBLIC_SITE_URL
  const token = outscraperWebhookToken(apiKey)
  const started: string[] = []
  const errors: string[] = []

  // ── Google ──────────────────────────────────────────────────────────────────
  if (config.place_id) {
    try {
      const webhookUrl = `${siteUrl}/api/webhooks/outscraper?source=google&token=${token}`
      await scrapeGoogleReviews({ placeId: config.place_id, webhookUrl })
      started.push('google')
    } catch (err) {
      errors.push(`google: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── TripAdvisor ─────────────────────────────────────────────────────────────
  if (config.tripadvisor_url) {
    try {
      const webhookUrl = `${siteUrl}/api/webhooks/outscraper?source=tripadvisor&token=${token}`
      await scrapeTripadvisorReviews({ listingUrl: config.tripadvisor_url, webhookUrl })
      started.push('tripadvisor')
    } catch (err) {
      errors.push(`tripadvisor: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Withlocals (synchronous — results available immediately) ────────────────
  let withlocalsResult: { imported: number; flagged: number; skipped: number } | null = null
  if (config.withlocals_experience_short_id) {
    try {
      withlocalsResult = await syncWithlocalsReviews(config.withlocals_experience_short_id)
      started.push('withlocals')
    } catch (err) {
      errors.push(`withlocals: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (started.length === 0 && errors.length > 0) {
    return apiError(errors.join('; '), 502)
  }

  return apiOk({
    started,
    withlocals: withlocalsResult ?? undefined,
    errors: errors.length > 0 ? errors : undefined,
  })
}
