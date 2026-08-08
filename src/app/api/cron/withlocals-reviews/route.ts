import { NextResponse, type NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { alertCronFailure } from '@/lib/cron/alert'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncWithlocalsReviews } from '@/lib/withlocals/sync'

/**
 * GET /api/cron/withlocals-reviews
 *
 * Scheduled weekly: Monday 08:00 UTC (see vercel.json) — corrected 2026-08-08;
 * Vercel Cron runs in UTC with no DST adjustment, so this is 09:00 Amsterdam
 * in winter (CET) but 10:00 in summer (CEST), not a fixed "08:00 Amsterdam".
 *
 * Silently skips if withlocals_experience_short_id is not configured.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  const supabase = createAdminClient()
  const { data: config } = await supabase
    .from('google_reviews_config')
    .select('withlocals_experience_short_id')
    .limit(1)
    .single()

  const shortId = config?.withlocals_experience_short_id
  if (!shortId) {
    return NextResponse.json({ skipped: true, reason: 'withlocals_experience_short_id not configured' })
  }

  try {
    const result = await syncWithlocalsReviews(shortId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    await alertCronFailure('withlocals-reviews', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
