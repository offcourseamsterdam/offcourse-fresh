import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseOutscraperPayload } from '@/lib/outscraper/parse'
import { outscraperWebhookToken } from '@/lib/outscraper/webhook-token'
import { postSlackText } from '@/lib/slack/send-notification'

/**
 * POST /api/webhooks/outscraper
 *
 * Single webhook endpoint for both Outscraper sources (manual Sync + the daily
 * Scheduler/"Monitoring" runs).
 *
 * Auth: a `?token=` derived from the API key (see webhook-token.ts) — works
 * regardless of whether Outscraper signs the request. A valid X-Hub-Signature-256
 * HMAC is also accepted as an alternative.
 *
 * Always returns 200 after the auth check so Outscraper doesn't retry-storm.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OUTSCRAPER_API_KEY ?? ''
  const rawBody = await request.text()

  // ── Auth: URL token (primary) OR valid HMAC (fallback) ──────────────────────
  const expectedToken = outscraperWebhookToken(apiKey)
  const tokenOk = request.nextUrl.searchParams.get('token') === expectedToken

  let hmacOk = false
  const sigHeader = request.headers.get('x-hub-signature-256')
  if (sigHeader) {
    const computed = `sha256=${createHmac('sha256', apiKey).update(rawBody).digest('hex')}`
    hmacOk = sigHeader === computed
  }

  if (!tokenOk && !hmacOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Determine source from query param ───────────────────────────────────────
  const source = request.nextUrl.searchParams.get('source') as 'google' | 'tripadvisor' | null
  if (source !== 'google' && source !== 'tripadvisor') {
    // Unknown source — accept gracefully (don't break Outscraper retries)
    return NextResponse.json({ received: true })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ received: true }) // malformed JSON, ignore
  }

  // ── Deduplication ───────────────────────────────────────────────────────────
  const requestId = payload.id as string | undefined
  if (requestId) {
    const supabase = createAdminClient()
    const { data: config } = await supabase
      .from('google_reviews_config')
      .select('id, outscraper_processed_ids')
      .limit(1)
      .single()

    if (config) {
      const processed: string[] = (config.outscraper_processed_ids as string[]) ?? []
      if (processed.includes(requestId)) {
        // Already processed — idempotent skip
        return NextResponse.json({ received: true, duplicate: true })
      }
      // Mark as processed
      await supabase
        .from('google_reviews_config')
        .update({ outscraper_processed_ids: [...processed, requestId].slice(-100) }) // keep last 100
        .eq('id', config.id)
    }
  }

  // ── Handle failure ──────────────────────────────────────────────────────────
  const status = payload.status as string | undefined
  if (status === 'Error' || status === 'Failure') {
    await postSlackText(
      `⚠️ Outscraper ${source} job failed (request ${requestId ?? 'unknown'}). Reviews not updated.`
    ).catch(() => {})
    return NextResponse.json({ received: true })
  }

  // ── Parse + upsert ──────────────────────────────────────────────────────────
  try {
    const supabase = createAdminClient()
    const { reviews, placeMeta } = parseOutscraperPayload(payload as Record<string, unknown>, source)

    // Dedupe within the batch — Postgres rejects an ON CONFLICT upsert that targets
    // the same (source, external_review_id) twice in one statement.
    const seen = new Set<string>()
    const uniqueReviews = reviews.filter(r => {
      const key = `${r.source}:${r.external_review_id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    if (uniqueReviews.length > 0) {
      const { error } = await supabase
        .from('social_proof_reviews')
        .upsert(
          uniqueReviews.map(r => ({
            ...r,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: 'source,external_review_id', ignoreDuplicates: false }
        )

      if (error) throw new Error(`Upsert failed: ${error.message}`)
    }

    // Update config stats for this source
    const configUpdate: Record<string, unknown> = {
      last_synced_at: new Date().toISOString(),
    }
    if (source === 'google') {
      if (placeMeta.overall_rating != null) configUpdate.overall_rating = placeMeta.overall_rating
      if (placeMeta.total_reviews != null) configUpdate.total_reviews = placeMeta.total_reviews
    } else {
      if (placeMeta.overall_rating != null) configUpdate.tripadvisor_rating = placeMeta.overall_rating
    }

    // PostgREST requires a WHERE clause on UPDATE; there is a single config row.
    await supabase.from('google_reviews_config').update(configUpdate).not('id', 'is', null)

    await postSlackText(`✅ Outscraper ${source}: imported ${uniqueReviews.length} review(s).`).catch(() => {})
    return NextResponse.json({ received: true, upserted: uniqueReviews.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await postSlackText(`🚨 Outscraper webhook error (${source}): ${msg}`).catch(() => {})
    // Still return 200 — don't let Outscraper retry-storm a broken handler
    return NextResponse.json({ received: true, error: msg })
  }
}
