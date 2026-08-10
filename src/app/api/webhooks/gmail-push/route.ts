import { NextResponse, after, type NextRequest } from 'next/server'
import { requirePubsubSecret } from '@/lib/auth/require-pubsub-secret'
import { syncGmailInbox } from '@/lib/gmail/sync'
import { alertCronFailure } from '@/lib/cron/alert'

/**
 * POST /api/webhooks/gmail-push?token=GMAIL_PUSH_WEBHOOK_SECRET
 *
 * Google Cloud Pub/Sub delivers a notification here the moment Gmail's
 * INBOX label changes (see lib/gmail/watch.ts for how the subscription is
 * registered). The push envelope only says "something changed, historyId
 * X" — it does NOT carry the new message itself, so this just re-triggers
 * the exact same syncGmailInbox() the polling cron already calls, sooner
 * than the next poll would. No new sync logic, just a faster trigger for
 * the existing one.
 *
 * Runs the sync via after() so Pub/Sub gets its 200 immediately — Pub/Sub
 * retries push deliveries that don't ack quickly, which would otherwise
 * risk piling up duplicate sync runs during a slow inbox sync.
 */
export async function POST(request: NextRequest) {
  const denied = requirePubsubSecret(request)
  if (denied) return denied

  after(() =>
    syncGmailInbox().catch(err => {
      console.error('[gmail-push] sync triggered by push failed:', err)
      return alertCronFailure('gmail-push', err)
    }),
  )

  return NextResponse.json({ ok: true })
}
