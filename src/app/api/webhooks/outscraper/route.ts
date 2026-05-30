import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseOutscraperPayload } from '@/lib/outscraper/parse'
import { postSlackText } from '@/lib/slack/send-notification'

/**
 * POST /api/webhooks/outscraper
 *
 * Single webhook endpoint for both Outscraper sources:
 *   - Google Maps Reviews Scraper results (from our manual Sync button)
 *   - TripAdvisor Reviews Scraper results
 *   - Outscraper Scheduler runs (the "Monitoring" automated daily jobs)
 *
 * Security: every Outscraper webhook is signed with HMAC-SHA256 using the API key.
 * Header: X-Hub-Signature-256: sha256=<hex>
 *
 * Always returns 200 after signature check so Outscraper doesn't retry-storm.
 */
export async function POST(request: NextRequest) {
  // ── Verify HMAC signature ───────────────────────────────────────────────────
  const apiKey = process.env.OUTSCRAPER_API_KEY ?? ''
  const sigHeader = request.headers.get('x-hub-signature-256') ?? ''
  const rawBody = await request.text()

  try {
    const computed = `sha256=${createHmac('sha256', apiKey).update(rawBody).digest('hex')}`
    const receivedBuf = Buffer.from(sigHeader.padEnd(computed.length, ' '))
    const computedBuf = Buffer.from(computed)
    if (receivedBuf.length !== computedBuf.length || !timingSafeEqual(receivedBuf, computedBuf)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
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

    if (reviews.length > 0) {
      const { error } = await supabase
        .from('social_proof_reviews')
        .upsert(
          reviews.map(r => ({
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

    await supabase.from('google_reviews_config').update(configUpdate).limit(1)

    return NextResponse.json({ received: true, upserted: reviews.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await postSlackText(`🚨 Outscraper webhook error (${source}): ${msg}`).catch(() => {})
    // Still return 200 — don't let Outscraper retry-storm a broken handler
    return NextResponse.json({ received: true, error: msg })
  }
}
