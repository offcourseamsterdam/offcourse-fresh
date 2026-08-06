import { NextResponse, type NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { alertCronFailure } from '@/lib/cron/alert'
import { syncGmailInbox } from '@/lib/gmail/sync'

/**
 * GET /api/cron/gmail-inbox-sync
 *
 * Scheduled every 2 minutes (see vercel.json). Pulls new messages from
 * cruise@offcourseamsterdam.com into the customer-chat inbox and hands each one
 * to the existing Ghost pipeline (draftShadowReply) — same as any webchat
 * message. A 2-minute poll is indistinguishable from instant for support email
 * and reuses the same OAuth client Google Ads already has, rather than the
 * added complexity of Gmail push notifications (Cloud Pub/Sub + a watch that
 * expires every 7 days).
 */
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    const result = await syncGmailInbox()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    await alertCronFailure('gmail-inbox-sync', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
