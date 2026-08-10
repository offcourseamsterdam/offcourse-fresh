import { NextResponse, type NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { alertCronFailure } from '@/lib/cron/alert'
import { registerGmailWatch } from '@/lib/gmail/watch'

/**
 * GET /api/cron/gmail-watch-renew
 *
 * Runs once daily (see vercel.json) — comfortably inside Vercel Hobby's
 * once-a-day cron limit. A Gmail push-notification "watch" expires after 7
 * days no matter what; re-registering it daily means it's never more than a
 * day from renewal, well clear of that deadline. See lib/gmail/watch.ts and
 * the push webhook at api/webhooks/gmail-push.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    const result = await registerGmailWatch()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    await alertCronFailure('gmail-watch-renew', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
