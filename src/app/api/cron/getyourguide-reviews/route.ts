import { NextResponse } from 'next/server'
import { syncGYGReviews } from '@/lib/getyourguide/sync'

/**
 * GET /api/cron/getyourguide-reviews
 *
 * Scheduled weekly (Monday 08:15 Amsterdam time — see vercel.json).
 * Fetches GYG reviews via JSON-LD from the activity page.
 * If Cloudflare blocks the request, logs a warning and returns blocked:true —
 * in that case use the admin computer-use import as a fallback.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncGYGReviews()
    if (result.blocked) {
      console.warn('[cron/getyourguide-reviews] GYG page blocked — manual computer-use import needed')
      return NextResponse.json({ ok: true, blocked: true, imported: 0, skipped: 0 })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/getyourguide-reviews]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
