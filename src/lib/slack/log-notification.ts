import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SlackNotificationKind } from './notification-types'

export interface LogSlackNotificationInput {
  kind: SlackNotificationKind
  destination: 'channel' | 'dm'
  /** Slack channel / user id for DMs. Null for the shared webhook. */
  channel?: string | null
  text: string
  status: 'sent' | 'failed'
  error?: string | null
}

/**
 * Write one sent (or failed) Slack message to the `slack_notifications` table so the
 * admin Operations → Notifications page can show it.
 *
 * NEVER throws and never rejects. This runs inside booking and payment paths — a
 * logging failure must not take a paid cruise down with it. Same philosophy as the
 * Slack send itself: best-effort side channel.
 *
 * No-ops when Supabase isn't configured (local dev without a service-role key, CI).
 */
export async function logSlackNotification(input: LogSlackNotificationInput): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return

  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('slack_notifications').insert({
      kind: input.kind,
      destination: input.destination,
      channel: input.channel ?? null,
      text: input.text,
      status: input.status,
      error: input.error ?? null,
    })
    if (error) console.error('[slack] logSlackNotification insert failed:', error.message)
  } catch (err) {
    console.error('[slack] logSlackNotification failed:', err)
  }
}
