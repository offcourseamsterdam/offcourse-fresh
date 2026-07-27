import { NextResponse, type NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { alertCronFailure } from '@/lib/cron/alert'
import { syncGYGReviews } from '@/lib/getyourguide/sync'

/**
 * GET /api/cron/getyourguide-reviews
 *
 * Scheduled weekly (Monday 08:15 Amsterdam time — see vercel.json).
 * Fetches GYG reviews via JSON-LD from the activity page.
 * If Cloudflare blocks the request, logs a warning and returns blocked:true —
 * in that case use the admin computer-use import as a fallback.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    const result = await syncGYGReviews()
    if (result.blocked) {
      console.warn('[cron/getyourguide-reviews] GYG page blocked — manual computer-use import needed')
      return NextResponse.json({ ok: true, blocked: true, imported: 0, skipped: 0 })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    await alertCronFailure('getyourguide-reviews', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
