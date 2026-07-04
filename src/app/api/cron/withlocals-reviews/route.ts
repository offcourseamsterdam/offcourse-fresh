import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncWithlocalsReviews } from '@/lib/withlocals/sync'

/**
 * GET /api/cron/withlocals-reviews
 *
 * Scheduled weekly (Monday 08:00 Amsterdam time — see vercel.json).
 * Also callable manually from /admin/reviews via the "Sync Withlocals" button.
 *
 * Silently skips if withlocals_experience_short_id is not configured.
 */
export async function GET(request: Request) {
  // Protect against external callers in production
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/withlocals-reviews]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
